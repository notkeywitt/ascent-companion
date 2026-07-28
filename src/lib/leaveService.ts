/**
 * PTO / sick-time accrual — SERVER orchestration (DB + roster + JobTread reads).
 * The pure math lives in ./leave; this module wires it to real data:
 *   - the employee roster (Apps Script "Employee" tab, over the shared secret),
 *   - worked hours (JobTread time entries, read live per user),
 *   - the companion DB (policies, balances, ledger).
 *
 * IMPORTANT: accrual is entirely companion-DB math and reads-only against
 * JobTread — it writes NOTHING to JobTread, so it is safe to run regardless of
 * COMPANION_WRITES_ENABLED. Only posting leave as a JobTread time entry (a
 * separate, gated path) writes to JobTread.
 *
 * Server-only (imports the DB + the grant-holding jobtread lib). Never import
 * into a client component.
 */
import { and, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { leaveBalances, leavePolicies, leaveRequests, leaveTransactions } from "@/db/schema";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getUserTimeEntries, jtIsoToOrgLocal } from "@/lib/jobtread";
import {
  accrualForPeriod,
  nextPeriodId,
  periodBounds,
  periodIdForDate,
  resolveAccrualRate,
  round2,
  workedHoursInPeriod,
  type AccrualPolicy,
  type LeaveType,
  type TenureTier,
  type WorkedBucketEntry,
} from "@/lib/leave";

// Entries whose JobTread job id or cost-code number is one of these are treated
// as leave time (so leave doesn't itself earn accrual). Configured once the
// leave job/cost items exist in JobTread (Phase 0 probe); empty until then.
const LEAVE_JOB_IDS = new Set(splitCsv(process.env.LEAVE_JOB_IDS));
const LEAVE_COST_CODES = new Set(splitCsv(process.env.LEAVE_COST_CODES));

// A guard so a bad hire date can't spin the per-employee period loop forever.
const MAX_PERIODS_PER_EMPLOYEE = 500;

function splitCsv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Roster ────────────────────────────────────────────────────────────────────
export interface RosterEmployee {
  employeeId: string;
  name: string;
  email: string;
  jtUserId: string;
  hireDate: string; // "YYYY-MM-DD" or "" if not set on the roster yet
  status: string;
}

async function callAppsScript(payload: Record<string, unknown>): Promise<unknown> {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) throw new Error("APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow",
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

function normalizeDate(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** The full roster from Apps Script, normalized. Callers filter for accrual. */
export async function fetchRoster(): Promise<RosterEmployee[]> {
  const data = (await callAppsScript({ action: "listEmployeesFull" })) as {
    ok?: boolean;
    error?: string;
    employees?: Array<Record<string, unknown>>;
  };
  if (data?.ok === false) throw new Error(data.error || "Could not load employees.");
  return (data.employees ?? []).map((e) => {
    const first = String(e.firstName ?? "").trim();
    const last = String(e.lastName ?? "").trim();
    return {
      employeeId: String(e.id ?? "").trim(),
      name: [first, last].filter(Boolean).join(" ") || String(e.name ?? "").trim(),
      email: String(e.email ?? "").trim().toLowerCase(),
      jtUserId: String(e.jtUserId ?? "").trim(),
      hireDate: normalizeDate(e.hireDate),
      status: String(e.status ?? "").trim(),
    };
  });
}

/** Resolve a signed-in Google email to its roster employee, or null. */
export async function employeeByEmail(email: string): Promise<RosterEmployee | null> {
  const want = (email ?? "").trim().toLowerCase();
  if (!want) return null;
  const roster = await fetchRoster();
  return roster.find((e) => e.email === want) ?? null;
}

/** Employees eligible to accrue: linked to JobTread and not clearly inactive. */
export function accruingEmployees(roster: RosterEmployee[]): RosterEmployee[] {
  return roster.filter(
    (e) => e.employeeId && e.jtUserId && !/inactive|terminat|former|left/i.test(e.status),
  );
}

// ── Policies ──────────────────────────────────────────────────────────────────
// Seed values only used the first time /time-off is opened; the office edits
// them afterwards. Sick mirrors the common California floor (1 hr per 30 worked,
// 48 hr cap, usable after 90 days). PTO ships at rate 0 so nothing accrues until
// the office sets the real rate.
const DEFAULT_POLICIES: AccrualPolicy[] = [
  { leaveType: "sick", hoursPerHourWorked: round2(1 / 30), annualCap: 48, carryoverCap: 48, waitingDays: 90, tenureTiers: [] },
  { leaveType: "pto", hoursPerHourWorked: 0, annualCap: 0, carryoverCap: 0, waitingDays: 0, tenureTiers: [] },
];

function parseTiers(json: string): TenureTier[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t) => ({ afterMonths: Number(t.afterMonths), hoursPerHourWorked: Number(t.hoursPerHourWorked) }))
      .filter((t) => Number.isFinite(t.afterMonths) && Number.isFinite(t.hoursPerHourWorked));
  } catch {
    return [];
  }
}

interface PolicyRow {
  leaveType: string;
  label: string;
  hoursPerHourWorked: string;
  annualCap: string;
  carryoverCap: string;
  waitingDays: number;
  tenureTiers: string;
  active: boolean;
}

function rowToPolicy(r: PolicyRow): AccrualPolicy {
  return {
    leaveType: r.leaveType as LeaveType,
    hoursPerHourWorked: Number(r.hoursPerHourWorked) || 0,
    annualCap: Number(r.annualCap) || 0,
    carryoverCap: Number(r.carryoverCap) || 0,
    waitingDays: r.waitingDays || 0,
    tenureTiers: parseTiers(r.tenureTiers),
  };
}

const DEFAULT_LABEL: Record<string, string> = { sick: "Sick Time", pto: "PTO / Vacation" };

/** Read policies, seeding defaults on first use. Returns the raw rows. */
export async function getPolicyRows(): Promise<PolicyRow[]> {
  await ensureDb();
  const rows = (await db.select().from(leavePolicies)) as PolicyRow[];
  const have = new Set(rows.map((r) => r.leaveType));
  const missing = DEFAULT_POLICIES.filter((p) => !have.has(p.leaveType));
  if (missing.length) {
    const now = new Date().toISOString();
    for (const p of missing) {
      await db.insert(leavePolicies).values({
        leaveType: p.leaveType,
        label: DEFAULT_LABEL[p.leaveType] ?? p.leaveType,
        hoursPerHourWorked: String(p.hoursPerHourWorked),
        annualCap: String(p.annualCap),
        carryoverCap: String(p.carryoverCap),
        waitingDays: p.waitingDays,
        tenureTiers: JSON.stringify(p.tenureTiers),
        active: true,
        updatedAt: now,
      });
    }
    return (await db.select().from(leavePolicies)) as PolicyRow[];
  }
  return rows;
}

export async function getActivePolicies(): Promise<AccrualPolicy[]> {
  return (await getPolicyRows()).filter((r) => r.active).map(rowToPolicy);
}

export async function updatePolicy(
  leaveType: string,
  fields: Partial<{
    label: string;
    hoursPerHourWorked: number;
    annualCap: number;
    carryoverCap: number;
    waitingDays: number;
    tenureTiers: TenureTier[];
    active: boolean;
  }>,
): Promise<void> {
  await ensureDb();
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (fields.label !== undefined) patch.label = fields.label;
  if (fields.hoursPerHourWorked !== undefined) patch.hoursPerHourWorked = String(fields.hoursPerHourWorked);
  if (fields.annualCap !== undefined) patch.annualCap = String(fields.annualCap);
  if (fields.carryoverCap !== undefined) patch.carryoverCap = String(fields.carryoverCap);
  if (fields.waitingDays !== undefined) patch.waitingDays = fields.waitingDays;
  if (fields.tenureTiers !== undefined) patch.tenureTiers = JSON.stringify(fields.tenureTiers);
  if (fields.active !== undefined) patch.active = fields.active;
  await db.update(leavePolicies).set(patch).where(eq(leavePolicies.leaveType, leaveType));
}

// ── Worked hours ──────────────────────────────────────────────────────────────
/** One user's completed JobTread entries → org-local, per-day buckets. Open
 *  (un-clocked-out) entries have no duration and are skipped. */
export async function fetchWorkedEntries(jtUserId: string): Promise<WorkedBucketEntry[]> {
  if (!hasGrant()) throw new Error("JT_GRANT_KEY is not set.");
  const entries = await getUserTimeEntries(getPaveConfig(), jtUserId);
  const out: WorkedBucketEntry[] = [];
  for (const e of entries) {
    if (!e.endedAt) continue; // still running — no hours yet
    const start = Date.parse(e.startedAt);
    const end = Date.parse(e.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const localDate = jtIsoToOrgLocal(e.startedAt).slice(0, 10);
    if (!localDate) continue;
    out.push({
      localDate,
      hours: round2((end - start) / 3_600_000),
      isLeave: LEAVE_JOB_IDS.has(e.jobId) || LEAVE_COST_CODES.has(e.costCode),
    });
  }
  return out;
}

// ── Accrual run ───────────────────────────────────────────────────────────────
export interface AccrualLine {
  employeeId: string;
  name: string;
  leaveType: LeaveType;
  period: string;
  workedHours: number;
  rate: number;
  hours: number; // granted this period
}

export interface AccrualResult {
  committed: boolean;
  throughPeriod: string;
  lines: AccrualLine[];
  totalsByType: Record<string, number>;
  skipped: Array<{ employeeId: string; name: string; reason: string }>;
}

function todayLocalDate(): string {
  return jtIsoToOrgLocal(new Date().toISOString()).slice(0, 10) || new Date().toISOString().slice(0, 10);
}

/** The pay periods to accrue for one employee: every COMPLETED period after the
 *  last one already accrued (or from hire / first worked period on a first run),
 *  up to and including `throughPeriod`. A period counts as completed only once
 *  its end date has passed. */
function periodsToAccrue(
  lastAccrued: string,
  hireDate: string,
  entries: WorkedBucketEntry[],
  throughPeriod: string,
  today: string,
): string[] {
  let start: string;
  if (lastAccrued) {
    start = nextPeriodId(lastAccrued);
  } else if (hireDate) {
    start = periodIdForDate(hireDate);
  } else {
    const earliest = entries.reduce((min, e) => (!min || e.localDate < min ? e.localDate : min), "");
    if (!earliest) return [];
    start = periodIdForDate(earliest);
  }
  const out: string[] = [];
  let p = start;
  for (let i = 0; i < MAX_PERIODS_PER_EMPLOYEE; i++) {
    if (p > throughPeriod) break;
    if (periodBounds(p).end >= today) break; // not finished yet
    out.push(p);
    p = nextPeriodId(p);
  }
  return out;
}

interface LedgerRow {
  employeeId: string;
  leaveType: string;
  kind: string;
  hours: string;
  period: string;
  createdAt: string;
}

/**
 * Run accrual for every eligible employee, from where each left off up through
 * the last completed pay period (or `throughPeriod` if given). `commit=false`
 * previews without writing. Idempotent: committed accrual rows carry a unique
 * (employee, type, period) key, so re-running never double-credits.
 */
export async function runAccrual(opts: {
  commit: boolean;
  throughPeriod?: string;
  actor?: string;
}): Promise<AccrualResult> {
  await ensureDb();
  const today = todayLocalDate();
  const cap = opts.throughPeriod?.trim() || periodIdForDate(today); // clamp; per-employee loop excludes unfinished periods
  const policies = await getActivePolicies();
  const roster = accruingEmployees(await fetchRoster());

  const lines: AccrualLine[] = [];
  const skipped: AccrualResult["skipped"] = [];
  const totalsByType: Record<string, number> = {};

  // Existing accrual totals per employee×type×year, so the annual cap is
  // honoured across periods within a run.
  const allTx = (await db.select().from(leaveTransactions)) as LedgerRow[];
  const yearTotals = new Map<string, number>(); // `${emp}|${type}|${year}` -> hrs
  const lastAccrued = new Map<string, string>(); // `${emp}|${type}` -> latest period
  for (const t of allTx) {
    if (t.kind !== "accrual") continue;
    const year = t.period.slice(0, 4);
    const yk = `${t.employeeId}|${t.leaveType}|${year}`;
    yearTotals.set(yk, (yearTotals.get(yk) ?? 0) + Number(t.hours));
    const k = `${t.employeeId}|${t.leaveType}`;
    if (t.period > (lastAccrued.get(k) ?? "")) lastAccrued.set(k, t.period);
  }

  const toInsert: Array<{ employeeId: string; leaveType: LeaveType; period: string; hours: number }> = [];

  for (const emp of roster) {
    let entries: WorkedBucketEntry[];
    try {
      entries = await fetchWorkedEntries(emp.jtUserId);
    } catch (e) {
      skipped.push({ employeeId: emp.employeeId, name: emp.name, reason: e instanceof Error ? e.message : "hours fetch failed" });
      continue;
    }
    for (const policy of policies) {
      const k = `${emp.employeeId}|${policy.leaveType}`;
      const periods = periodsToAccrue(lastAccrued.get(k) ?? "", emp.hireDate, entries, cap, today);
      for (const period of periods) {
        const worked = workedHoursInPeriod(entries, period);
        const asOf = periodBounds(period).end;
        const rate = resolveAccrualRate(policy, emp.hireDate, asOf);
        const year = period.slice(0, 4);
        const yk = `${emp.employeeId}|${policy.leaveType}|${year}`;
        const accruedThisYear = yearTotals.get(yk) ?? 0;
        const hours = accrualForPeriod({ rate, workedHours: worked, accruedThisYear, annualCap: policy.annualCap });
        if (hours <= 0) continue;
        yearTotals.set(yk, accruedThisYear + hours);
        lines.push({ employeeId: emp.employeeId, name: emp.name, leaveType: policy.leaveType, period, workedHours: worked, rate, hours });
        totalsByType[policy.leaveType] = round2((totalsByType[policy.leaveType] ?? 0) + hours);
        toInsert.push({ employeeId: emp.employeeId, leaveType: policy.leaveType, period, hours });
      }
    }
  }

  if (opts.commit && toInsert.length) {
    const now = new Date().toISOString();
    for (const row of toInsert) {
      await db
        .insert(leaveTransactions)
        .values({
          employeeId: row.employeeId,
          leaveType: row.leaveType,
          kind: "accrual",
          hours: String(row.hours),
          period: row.period,
          note: "",
          createdBy: opts.actor ?? "accrual",
          createdAt: now,
        })
        .onConflictDoNothing();
    }
    // Recompute affected balances from the ledger (authoritative).
    const affected = new Map<string, { employeeId: string; leaveType: LeaveType; jtUserId: string }>();
    for (const row of toInsert) {
      affected.set(`${row.employeeId}|${row.leaveType}`, {
        employeeId: row.employeeId,
        leaveType: row.leaveType,
        jtUserId: roster.find((e) => e.employeeId === row.employeeId)?.jtUserId ?? "",
      });
    }
    for (const a of affected.values()) await recomputeBalance(a.employeeId, a.leaveType, a.jtUserId);
  }

  return { committed: !!opts.commit, throughPeriod: cap, lines, totalsByType, skipped };
}

// ── Balances & ledger ─────────────────────────────────────────────────────────
/** Rebuild one balance row from its ledger (accrual + adjustment − taken). */
export async function recomputeBalance(
  employeeId: string,
  leaveType: LeaveType,
  jtUserId = "",
): Promise<void> {
  await ensureDb();
  const rows = (await db
    .select()
    .from(leaveTransactions)
    .where(and(eq(leaveTransactions.employeeId, employeeId), eq(leaveTransactions.leaveType, leaveType)))) as LedgerRow[];
  let accrued = 0;
  let used = 0;
  let through = "";
  for (const r of rows) {
    const h = Number(r.hours) || 0;
    if (r.kind === "accrual") {
      accrued += h;
      if (r.period > through) through = r.period;
    } else if (r.kind === "taken") {
      used += Math.abs(h);
    } else {
      // adjustment: signed — positive adds accrued, negative counts as used
      if (h >= 0) accrued += h;
      else used += Math.abs(h);
    }
  }
  const balance = round2(accrued - used);
  const now = new Date().toISOString();
  const existing = (await db
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveType, leaveType)))) as Array<{ id: number }>;
  if (existing.length) {
    await db
      .update(leaveBalances)
      .set({ accrued: String(round2(accrued)), used: String(round2(used)), balance: String(balance), accruedThroughPeriod: through, jtUserId, updatedAt: now })
      .where(eq(leaveBalances.id, existing[0].id));
  } else {
    await db.insert(leaveBalances).values({
      employeeId,
      jtUserId,
      leaveType,
      accrued: String(round2(accrued)),
      used: String(round2(used)),
      balance: String(balance),
      accruedThroughPeriod: through,
      updatedAt: now,
    });
  }
}

/** Record a manual adjustment or an opening-balance import row, then rebuild the
 *  balance. Positive hours add, negative subtract. */
export async function recordAdjustment(opts: {
  employeeId: string;
  jtUserId?: string;
  leaveType: LeaveType;
  hours: number;
  note: string;
  actor: string;
}): Promise<void> {
  await ensureDb();
  await db.insert(leaveTransactions).values({
    employeeId: opts.employeeId,
    leaveType: opts.leaveType,
    kind: "adjustment",
    hours: String(round2(opts.hours)),
    period: "",
    note: opts.note,
    createdBy: opts.actor,
    createdAt: new Date().toISOString(),
  });
  await recomputeBalance(opts.employeeId, opts.leaveType, opts.jtUserId ?? "");
}

export async function listBalances(): Promise<Array<Record<string, unknown>>> {
  await ensureDb();
  return (await db.select().from(leaveBalances)) as Array<Record<string, unknown>>;
}

export async function listLedger(employeeId: string): Promise<Array<Record<string, unknown>>> {
  await ensureDb();
  const rows = (await db
    .select()
    .from(leaveTransactions)
    .where(eq(leaveTransactions.employeeId, employeeId))) as Array<Record<string, unknown>>;
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** One employee's current balances, one entry per active leave type (0 if the
 *  employee has no ledger yet). For the field self-service view. */
export async function balancesForEmployee(
  employeeId: string,
): Promise<Array<{ leaveType: LeaveType; balance: number; accrued: number; used: number }>> {
  await ensureDb();
  const rows = (await db
    .select()
    .from(leaveBalances)
    .where(eq(leaveBalances.employeeId, employeeId))) as Array<{
    leaveType: string;
    balance: string;
    accrued: string;
    used: string;
  }>;
  const byType = new Map(rows.map((r) => [r.leaveType, r]));
  const policies = await getActivePolicies();
  return policies.map((p) => {
    const r = byType.get(p.leaveType);
    return {
      leaveType: p.leaveType,
      balance: r ? Number(r.balance) || 0 : 0,
      accrued: r ? Number(r.accrued) || 0 : 0,
      used: r ? Number(r.used) || 0 : 0,
    };
  });
}

// ── Requests (self-service) ───────────────────────────────────────────────────
export async function createLeaveRequest(opts: {
  employeeId: string;
  jtUserId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  hours: number;
  note: string;
  actor: string;
}): Promise<{ id: number }> {
  await ensureDb();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(leaveRequests)
    .values({
      employeeId: opts.employeeId,
      jtUserId: opts.jtUserId,
      leaveType: opts.leaveType,
      startDate: opts.startDate,
      endDate: opts.endDate,
      hours: String(round2(opts.hours)),
      note: opts.note,
      status: "pending",
      createdBy: opts.actor,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { id: (row as { id: number }).id };
}

export async function listRequests(filter: {
  employeeId?: string;
  status?: string;
}): Promise<Array<Record<string, unknown>>> {
  await ensureDb();
  const rows = (await db.select().from(leaveRequests)) as Array<Record<string, unknown>>;
  return rows
    .filter((r) => (filter.employeeId ? r.employeeId === filter.employeeId : true))
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Approve or deny a pending request. Approving records a `taken` ledger row
 * (negative hours) and rebuilds the balance — the companion balance is the
 * truth for PTO/sick. Posting the approved leave to JobTread as a time entry is
 * a separate, gated step (a later phase); `jtEntryId` stays empty until then.
 */
export async function decideLeaveRequest(opts: {
  id: number;
  approve: boolean;
  actor: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDb();
  const [req] = (await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, opts.id))) as Array<{
    id: number;
    employeeId: string;
    jtUserId: string;
    leaveType: string;
    hours: string;
    status: string;
  }>;
  if (!req) return { ok: false, error: "Request not found." };
  if (req.status !== "pending") return { ok: false, error: `Request already ${req.status}.` };

  const now = new Date().toISOString();
  if (opts.approve) {
    const hours = Number(req.hours) || 0;
    await db.insert(leaveTransactions).values({
      employeeId: req.employeeId,
      leaveType: req.leaveType,
      kind: "taken",
      hours: String(round2(-Math.abs(hours))), // stored negative
      period: "",
      note: `request #${req.id}`,
      createdBy: opts.actor,
      createdAt: now,
    });
    await recomputeBalance(req.employeeId, req.leaveType as LeaveType, req.jtUserId);
  }
  await db
    .update(leaveRequests)
    .set({ status: opts.approve ? "approved" : "denied", decidedBy: opts.actor, decidedAt: now, updatedAt: now })
    .where(eq(leaveRequests.id, opts.id));
  return { ok: true };
}
