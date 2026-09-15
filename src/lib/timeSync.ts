/**
 * Time-record reconciliation — the redundancy layer. Every worked-time entry is
 * saved to the Apps Script "Time Entries" sheet BEFORE JobTread is contacted, so
 * a JobTread failure can never lose a record; this module surfaces any record
 * that hasn't reached JobTread yet and re-posts it on demand. Leave lives in the
 * companion DB and is handled by leaveService's listUnsyncedLeave/retryLeavePost.
 *
 * Worked-time retry reuses EXISTING Apps Script actions: `listTimeEntries`
 * returns every field needed to re-post (user/job/cost/pay type/times), and
 * `finalizeTimeEntryLog` (keyed by the row's EntryID = its idempotency key)
 * writes the JobTread id + status back. So no Apps Script change is needed.
 *
 * ## TWO WAYS A RECORD GOES WRONG, AND TWO DEPTHS OF CHECK
 *
 * "Not pushed" is only half of it. A clock-OUT that JobTread refuses leaves the
 * clock-in entry OPEN in JobTread — the record exists, carries an id, and shows
 * the wrong hours. That is the shape an employee reports as "JobTread doesn't
 * match what I logged", and a filter for "no JobTread id" hides it completely.
 *
 * So there are two depths here:
 *
 *   `listTimeProblems()` — SHEET ONLY, no JobTread call. Reads the row's own
 *     JobTread Entry ID and Status columns, which already record the outcome of
 *     the push. Cheap enough for a page load or a launcher badge.
 *   `auditWorked()` — the sheet check PLUS a JobTread cross-check over a short
 *     window, which is the only way to catch the silent cases: an entry deleted
 *     in JobTread, one still running, one whose times no longer match what the
 *     employee logged. Costs one paged JobTread read, so it runs on the digest's
 *     schedule, not on every page load.
 *
 * Server-only (JobTread grant + shared secret). The JobTread write is still
 * gated by COMPANION_WRITES_ENABLED.
 */
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import {
  createTimeEntry,
  getOrgTimeEntries,
  getTimeEntrySpan,
  getUserTimeEntries,
  jtIsoToOrgLocal,
  orgLocalToJtIso,
} from "@/lib/jobtread";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import {
  PROBLEM_ORDER,
  PROBLEM_RETRYABLE,
  clockOf,
  driftMinutes,
  isErrorStatus,
  sheetProblem,
  type TimeProblem,
} from "@/lib/timeProblems";


export interface WorkedRow {
  entryId: string;
  date: string;
  employee: string;
  jtUserId: string;
  jobLabel: string;
  jobId: string;
  costCode: string;
  costItemId: string;
  payType: string;
  start: string;
  end: string;
  note: string;
  jtStatus: string;
}

interface RawWorkedRow {
  entryId?: string;
  date?: string;
  employee?: string;
  jtUserId?: string;
  jobLabel?: string;
  jobId?: string;
  costCode?: string;
  costItemId?: string;
  payType?: string;
  start?: string;
  end?: string;
  note?: string;
  jtEntryId?: string;
  jtStatus?: string;
}

/** A record with something wrong, plus what JobTread holds when we looked. */
export interface ProblemRow extends WorkedRow {
  problem: TimeProblem;
  /** The JobTread entry id on the row, when it has one. */
  jtEntryId: string;
  /** JobTread's own start/stop, as org-local wall clocks. Only set by `auditWorked`. */
  jtStart?: string;
  jtEnd?: string;
  /** One sentence naming the difference, for the row's second line. */
  detail: string;
  /** True when a Retry can safely re-post this row (see `retryWorked`). */
  retryable: boolean;
}

// Apps Script calls go through the shared client (src/lib/appsScript.ts), which
// owns the timeout, the retry policy, and the 302/`ok` protocol in one place.
//
// The retry policy matters more here than anywhere else in the app: this module
// exists to stop time records being lost, and a careless retry would instead
// DUPLICATE them. `isRetryable()` decides from the action name — `listTimeEntries`
// is a read and retries automatically; `finalizeTimeEntryLog` writes the JobTread
// id back and is never retried. Don't pass `retry: true` to a finalize call.

async function allWorkedRows(): Promise<RawWorkedRow[]> {
  const data = (await callAppsScriptOrThrow({ action: "listTimeEntries" }, { timeoutMs: 50_000 })) as {
    ok?: boolean;
    error?: string;
    rows?: RawWorkedRow[];
  };
  if (data?.ok === false) throw new Error(data.error || "Could not read the Time Entries sheet.");
  return data.rows ?? [];
}

const notInJt = (r: RawWorkedRow) => !String(r.jtEntryId ?? "").trim();

function toWorkedRow(r: RawWorkedRow): WorkedRow {
  return {
    entryId: String(r.entryId ?? "").trim(),
    date: String(r.date ?? "").trim(),
    employee: String(r.employee ?? "").trim(),
    jtUserId: String(r.jtUserId ?? "").trim(),
    jobLabel: String(r.jobLabel ?? "").trim(),
    jobId: String(r.jobId ?? "").trim(),
    costCode: String(r.costCode ?? "").trim(),
    costItemId: String(r.costItemId ?? "").trim(),
    payType: String(r.payType ?? "").trim(),
    start: String(r.start ?? "").trim(),
    end: String(r.end ?? "").trim(),
    note: String(r.note ?? "").trim(),
    jtStatus: String(r.jtStatus ?? "").trim(),
  };
}

function sheetDetail(row: WorkedRow, problem: TimeProblem): string {
  if (problem === "not-posted") {
    return row.jtStatus || "The record is in the sheet with no JobTread entry.";
  }
  // push-failed carries JobTread's own refusal, which is the useful part.
  return row.jtStatus || "JobTread refused the push.";
}

function toProblemRow(raw: RawWorkedRow, problem: TimeProblem, detail: string): ProblemRow {
  return {
    ...toWorkedRow(raw),
    problem,
    jtEntryId: String(raw.jtEntryId ?? "").trim(),
    detail,
    // Only a record JobTread has never accepted may be re-created. A row that
    // already names an entry gets repaired in JobTread, never re-posted — see
    // `retryWorked`.
    retryable: PROBLEM_RETRYABLE[problem],
  };
}

/**
 * Every worked-time record the SHEET says did not reach JobTread cleanly, plus
 * counts. No JobTread call, so this is what a page load and a launcher badge use.
 */
export async function listTimeProblems(): Promise<{
  rows: ProblemRow[];
  total: number;
  unsynced: number;
  problems: number;
}> {
  const all = await allWorkedRows();
  const rows: ProblemRow[] = [];
  for (const raw of all) {
    const problem = sheetProblem(String(raw.jtEntryId ?? ""), String(raw.jtStatus ?? ""));
    if (!problem) continue;
    rows.push(toProblemRow(raw, problem, sheetDetail(toWorkedRow(raw), problem)));
  }
  rows.sort(byProblemThenDate);
  return {
    rows,
    total: all.length,
    unsynced: rows.filter((r) => r.problem === "not-posted").length,
    problems: rows.length,
  };
}

function byProblemThenDate(a: ProblemRow, b: ProblemRow): number {
  const p = PROBLEM_ORDER.indexOf(a.problem) - PROBLEM_ORDER.indexOf(b.problem);
  return p !== 0 ? p : (b.date || b.start).localeCompare(a.date || a.start);
}

/** Worked-time entries saved to the sheet but not yet in JobTread, plus counts. */
export async function listUnsyncedWorked(): Promise<{ rows: WorkedRow[]; total: number; unsynced: number }> {
  const all = await allWorkedRows();
  const rows = all.filter(notInJt).map(toWorkedRow);
  return { rows, total: all.length, unsynced: rows.length };
}

/* ------------------------------------------------------------------ audit */

export interface AuditOptions {
  /** How far back to cross-check rows against JobTread. Default 7 days. */
  windowDays?: number;
  /** Minutes of start/stop drift that still counts as a match. Default 2. */
  toleranceMinutes?: number;
  /** Ceiling on one-by-one JobTread lookups for ids the window pull missed. */
  maxDirectLookups?: number;
}

export interface AuditResult {
  rows: ProblemRow[];
  /** Every row in the sheet. */
  total: number;
  /** Rows with no JobTread id — the count the Time Sync page has always shown. */
  unsynced: number;
  /** Rows cross-checked against JobTread (the window's worth). */
  checked: number;
  /** The window actually used, as local calendar dates. */
  from: string;
  to: string;
  /** Set when the JobTread half could not run; the sheet half still did. */
  jtError?: string;
}

/** Today's local calendar date, `back` days earlier. Calendar arithmetic, DST-safe. */
function daysBefore(today: string, back: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - back * 86_400_000).toISOString().slice(0, 10);
}

/** Sentinel for "we asked JobTread by id and it has no such entry". */
const MISSING: { startedAt: string; endedAt: string | null } = { startedAt: "", endedAt: null };

/**
 * The deep check: the sheet's own verdict, plus what JobTread actually holds for
 * every recent row that looked fine.
 *
 * WHY A WINDOW. The Time Entries tab grows forever and the rows that matter are
 * this week's — an employee reports a wrong day within a day or two. Bounding
 * the cross-check keeps it to ONE paged JobTread read. `not-posted` rows are NOT
 * windowed: a record stranded three weeks ago is still a record nobody has, and
 * the Time Sync page has always listed all of them.
 *
 * Never throws for a JobTread failure — the sheet half is the half that proves
 * nothing was lost, so it is reported with `jtError` set rather than dropped.
 */
export async function auditWorked(opts: AuditOptions = {}): Promise<AuditResult> {
  const windowDays = Math.max(1, opts.windowDays ?? 7);
  const tolerance = Math.max(0, opts.toleranceMinutes ?? 2);
  const maxDirect = Math.max(0, opts.maxDirectLookups ?? 25);

  const all = await allWorkedRows();
  const today = jtIsoToOrgLocal(new Date().toISOString()).slice(0, 10);
  const from = daysBefore(today, windowDays - 1);

  const rows: ProblemRow[] = [];
  // Rows the sheet already condemns never reach the cross-check: their problem
  // is known and JobTread cannot make it better.
  const toCheck: RawWorkedRow[] = [];
  for (const raw of all) {
    const problem = sheetProblem(String(raw.jtEntryId ?? ""), String(raw.jtStatus ?? ""));
    if (problem) {
      rows.push(toProblemRow(raw, problem, sheetDetail(toWorkedRow(raw), problem)));
      continue;
    }
    const day = String(raw.date ?? "").trim().slice(0, 10) || String(raw.start ?? "").slice(0, 10);
    if (day >= from && day <= today) toCheck.push(raw);
  }

  const base: AuditResult = {
    rows,
    total: all.length,
    unsynced: rows.filter((r) => r.problem === "not-posted").length,
    checked: 0,
    from,
    to: today,
  };

  if (!toCheck.length) {
    rows.sort(byProblemThenDate);
    return base;
  }
  if (!hasGrant()) {
    rows.sort(byProblemThenDate);
    return { ...base, jtError: "No JobTread grant is configured, so nothing was cross-checked." };
  }

  let spans: Map<string, { startedAt: string; endedAt: string | null }>;
  try {
    // Pad the pull by a day either side: an entry re-timed across midnight is
    // still the same entry, and a miss here becomes a one-off direct lookup.
    // (A negative `back` walks forward — tomorrow, so today is fully covered.)
    const cfg = getPaveConfig();
    const pulled = await getOrgTimeEntries(cfg, {
      sinceIso: orgLocalToJtIso(`${daysBefore(from, 1)}T00:00`),
      untilIso: orgLocalToJtIso(`${daysBefore(today, -1)}T00:00`),
    });
    spans = new Map(pulled.map((e) => [e.id, { startedAt: e.startedAt, endedAt: e.endedAt }]));

    // Anything the window pull didn't cover, asked for by id — bounded, because
    // this is the exception (an entry re-timed far away, or deleted).
    let direct = 0;
    for (const raw of toCheck) {
      const id = String(raw.jtEntryId ?? "").trim();
      if (spans.has(id)) continue;
      if (direct >= maxDirect) break;
      direct++;
      const span = await getTimeEntrySpan(cfg, id);
      if (span) spans.set(id, { startedAt: span.startedAt, endedAt: span.endedAt });
      else spans.set(id, MISSING);
    }
  } catch (e) {
    rows.sort(byProblemThenDate);
    return { ...base, jtError: e instanceof Error ? e.message : "Could not read JobTread time entries." };
  }

  let checked = 0;
  for (const raw of toCheck) {
    const id = String(raw.jtEntryId ?? "").trim();
    const span = spans.get(id);
    if (!span) continue; // never looked it up (past maxDirect) — say nothing
    checked++;
    const row = toWorkedRow(raw);

    if (span === MISSING) {
      rows.push(toProblemRow(raw, "missing-in-jt", `JobTread has no entry ${id}. It was deleted there.`));
      continue;
    }

    const jtStart = jtIsoToOrgLocal(span.startedAt);
    const jtEnd = span.endedAt ? jtIsoToOrgLocal(span.endedAt) : "";

    if (!span.endedAt) {
      if (!row.end) continue; // the row is an open clock-in too — nothing wrong
      rows.push({
        ...toProblemRow(
          raw,
          "open-in-jt",
          `Logged ${clockOf(row.start)}–${clockOf(row.end)}, but JobTread still has it running. ` +
            `Its hours are wrong until someone sets the stop time there.`,
        ),
        jtStart,
        jtEnd: "",
      });
      continue;
    }

    const startDrift = driftMinutes(row.start, jtStart);
    const endDrift = driftMinutes(row.end, jtEnd);
    const off = [
      Number.isFinite(startDrift) && startDrift > tolerance
        ? `start ${clockOf(row.start)} → ${clockOf(jtStart)}`
        : "",
      Number.isFinite(endDrift) && endDrift > tolerance ? `stop ${clockOf(row.end)} → ${clockOf(jtEnd)}` : "",
    ].filter(Boolean);
    if (!off.length) continue;

    rows.push({
      ...toProblemRow(raw, "time-mismatch", `JobTread holds a different ${off.join(" and ")}.`),
      jtStart,
      jtEnd,
    });
  }

  rows.sort(byProblemThenDate);
  return { ...base, rows, checked };
}

/* ------------------------------------------------------------------ retry */

/**
 * Has JobTread already got this record?
 *
 * WHY THIS EXISTS. A clock-out reserves its sheet row with an EMPTY JobTread id
 * and fills it in after the update lands. If the serverless function dies in
 * between, the row reads "not posted" although the clock-IN entry is sitting in
 * JobTread — and a Retry that goes straight to `createTimeEntry` would put a
 * SECOND entry beside it, which is a payroll error nobody would spot.
 *
 * MATCHING IS DELIBERATELY NARROW, because adopting the wrong entry is as bad as
 * creating a duplicate. Same employee, same job, same start minute, AND either:
 *   - the entry is still OPEN — the stranded clock-out, exactly what we expect
 *     to find (adopting it is right, and the audit then reports it as
 *     `open-in-jt` until someone sets its stop time); or
 *   - it is closed and its stop time matches too — the same shift, twice.
 * A closed entry that starts at the same minute but ends elsewhere is a
 * DIFFERENT record (a split shift, a correction), so it is left alone.
 */
async function findExistingEntry(
  row: WorkedRow,
  toleranceMinutes = 5,
): Promise<{ id: string; open: boolean } | null> {
  const startedAt = orgLocalToJtIso(row.start);
  if (!startedAt || !row.jtUserId) return null;
  const at = Date.parse(startedAt);
  if (!Number.isFinite(at)) return null;
  const endAt = Date.parse(orgLocalToJtIso(row.end));
  const pad = 6 * 3_600_000; // a generous half-day either side; the match is on the minute
  const near = await getUserTimeEntries(getPaveConfig(), row.jtUserId, {
    sinceIso: new Date(at - pad).toISOString(),
    untilIso: new Date(at + pad).toISOString(),
  });
  const close = (a: number, b: number) => Math.abs(a - b) / 60_000 <= toleranceMinutes;
  const hit = near.find((e) => {
    if (row.jobId && e.jobId !== row.jobId) return false;
    if (!close(Date.parse(e.startedAt), at)) return false;
    if (!e.endedAt) return true;
    return Number.isFinite(endAt) && close(Date.parse(e.endedAt), endAt);
  });
  return hit ? { id: hit.id, open: !hit.endedAt } : null;
}

/** Re-post one worked-time row to JobTread and write the result back to the
 *  sheet. Idempotent guard: a row that already carries a JobTread id is skipped,
 *  and a row whose entry turns out to exist anyway is ADOPTED rather than
 *  re-created (see `findExistingEntry`). */
export async function retryWorked(
  entryId: string,
): Promise<{ ok: boolean; jtStatus: string; jtEntryId?: string; error?: string }> {
  const id = entryId.trim();
  if (!id) return { ok: false, jtStatus: "", error: "No entryId." };
  const raw = (await allWorkedRows()).find((r) => String(r.entryId ?? "").trim() === id);
  if (!raw) return { ok: false, jtStatus: "", error: "Row not found." };
  if (!notInJt(raw)) {
    // The record IS in JobTread. If its status says the push failed, what failed
    // was the clock-OUT — the fix is to set the stop time on that entry in
    // JobTread, never to create a second one here.
    const jtEntryId = String(raw.jtEntryId).trim();
    return isErrorStatus(String(raw.jtStatus ?? ""))
      ? {
          ok: false,
          jtStatus: "already in JobTread",
          jtEntryId,
          error:
            "JobTread already holds this entry — its stop time is what didn't land. " +
            "Open it in JobTread and set the stop time; re-posting would duplicate it.",
        }
      : { ok: true, jtStatus: "already posted", jtEntryId };
  }
  if (!writesEnabled()) return { ok: false, jtStatus: "not posted (writes off)", error: "JobTread writes are off." };
  if (!hasGrant()) return { ok: false, jtStatus: "", error: "No JobTread grant configured." };

  const row = toWorkedRow(raw);
  const startedAt = orgLocalToJtIso(row.start);
  const endedAt = orgLocalToJtIso(row.end);
  const missing = [
    !row.jtUserId && "JobTread user",
    !row.jobId && "job",
    !row.costItemId && "cost code",
    !row.payType && "pay type",
    !startedAt && "start time",
    !endedAt && "end time",
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, jtStatus: "", error: `Row is missing ${missing.join(", ")} — fix it in the sheet, then retry.` };
  }

  // Look before you create. A failure between the JobTread write and the sheet
  // write-back leaves exactly this state, and creating here is the duplicate
  // this module exists to prevent. A failed look must not block the retry — a
  // stranded record is the bigger harm — so it falls through to the create.
  try {
    const existing = await findExistingEntry(row);
    if (existing) {
      await callAppsScriptOrThrow({
        action: "finalizeTimeEntryLog",
        clientKey: id,
        jtEntryId: existing.id,
        jtStatus: "adopted (already in JobTread)",
      });
      return {
        ok: true,
        jtStatus: "adopted (already in JobTread)",
        jtEntryId: existing.id,
        // An adopted OPEN entry still counts the wrong hours. Say so here, and
        // the next audit reports it as `open-in-jt` until someone closes it.
        error: existing.open
          ? "JobTread already had this entry, still running. The record now names it — " +
            "set its stop time in JobTread so it counts the right hours."
          : undefined,
      };
    }
  } catch {
    /* couldn't check — fall through and create, as this function always did */
  }

  try {
    const { id: jtEntryId } = await createTimeEntry(getPaveConfig(), {
      userId: row.jtUserId,
      jobId: row.jobId,
      costItemId: row.costItemId,
      startedAt,
      endedAt,
      type: row.payType,
      notes: row.note,
      isApproved: false,
    });
    // The entry now EXISTS in JobTread. If writing its id back to the sheet
    // fails, letting that throw would report the whole retry as failed — and the
    // next retry would create a SECOND entry, the exact duplication this module
    // exists to prevent. So report success and name the id, with a status that
    // tells the user the sheet still needs it.
    try {
      await callAppsScriptOrThrow({
        action: "finalizeTimeEntryLog",
        clientKey: id,
        jtEntryId,
        jtStatus: "pushed (retry)",
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : "Unknown error";
      return {
        ok: true,
        jtStatus: "pushed, sheet not updated",
        jtEntryId,
        error:
          `Posted to JobTread as ${jtEntryId}, but writing that id back to the sheet failed ` +
          `(${why}). Paste it into the row's JobTread Entry ID before retrying, or the retry ` +
          `will create a duplicate.`,
      };
    }
    return { ok: true, jtStatus: "pushed", jtEntryId };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    // Best-effort: recording WHY it failed must never replace the real error.
    try {
      await callAppsScriptOrThrow({
        action: "finalizeTimeEntryLog",
        clientKey: id,
        jtEntryId: "",
        jtStatus: "JobTread error: " + error,
      });
    } catch {
      /* the sheet keeps the row unsynced, which is the safe state */
    }
    return { ok: false, jtStatus: "JobTread error", error };
  }
}
