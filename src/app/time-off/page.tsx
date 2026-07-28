"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Loading,
  PageHeader,
  SectionLabel,
  Select,
  Toggle,
} from "@/components/ui";

// ── Types (mirror the /api/time-off payloads) ────────────────────────────────
interface Balance {
  employeeId: string;
  name: string;
  jtUserId: string;
  leaveType: "sick" | "pto";
  accrued: string;
  used: string;
  balance: string;
  accruedThroughPeriod: string;
}
interface Policy {
  leaveType: "sick" | "pto";
  label: string;
  hoursPerHourWorked: string;
  annualCap: string;
  carryoverCap: string;
  waitingDays: number;
  tenureTiers: string;
  active: boolean;
}
interface RosterEmp {
  employeeId: string;
  name: string;
  jtUserId: string;
  hireDate: string;
  status: string;
}
interface AccrualLine {
  employeeId: string;
  name: string;
  leaveType: "sick" | "pto";
  period: string;
  workedHours: number;
  rate: number;
  hours: number;
}
interface AccrualResult {
  committed: boolean;
  throughPeriod: string;
  lines: AccrualLine[];
  totalsByType: Record<string, number>;
  skipped: Array<{ employeeId: string; name: string; reason: string }>;
}
interface LedgerRow {
  id: number;
  leaveType: string;
  kind: string;
  hours: string;
  period: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

const TYPES: Array<"sick" | "pto"> = ["sick", "pto"];
const hrs = (v: string | number) => {
  const n = Number(v);
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : String(v);
};
/** A friendly gloss on the tiny per-hour rate: "≈ 1 hr per 30 worked". */
function rateHint(rate: number): string {
  if (!rate || rate <= 0) return "no accrual";
  return `≈ 1 hr per ${Math.round((1 / rate) * 10) / 10} worked`;
}

export default function TimeOffPage() {
  const access = useAccess();
  const isOffice = access.can("time-off-admin");

  const [balances, setBalances] = useState<Balance[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [roster, setRoster] = useState<RosterEmp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/time-off/balances");
      const json = await res.json();
      if (!res.ok || json.ok === false) setError(json.error ?? "Failed to load.");
      else {
        setBalances(json.balances ?? []);
        setPolicies(json.policies ?? []);
        setRoster(json.roster ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOffice) load();
    else setLoading(false);
  }, [isOffice, load]);

  // Merge Sick + PTO into one row per employee for the balances table.
  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; sick?: Balance; pto?: Balance }>();
    for (const b of balances) {
      const e = map.get(b.employeeId) ?? { name: b.name || b.employeeId };
      e[b.leaveType] = b;
      if (b.name) e.name = b.name;
      map.set(b.employeeId, e);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [balances]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <PageHeader
        title="Time Off"
        description={
          isOffice
            ? "Your balance and requests, plus office accrual, balances, and policy."
            : "Your PTO and sick-time balance, and request time off."
        }
      />

      {/* Everyone — the signed-in user's own balance + request flow. */}
      <SelfServiceSection />

      {/* Office/admin — management dashboard. */}
      {isOffice && (
        <>
          {error && (
            <Banner tone="error" className="mb-4 mt-5">
              {note && <div className="mb-1 font-medium">{note}</div>}
              {error}
            </Banner>
          )}
          {loading ? (
            <Loading label="Loading balances…" />
          ) : (
            <div className="mt-5 space-y-5">
              <RequestsQueueCard onChanged={load} />
              <AccrualCard onDone={load} setBanner={(t) => { setNote(t.note); setError(t.error); }} />
              <BalancesCard byEmployee={byEmployee} roster={roster} onChanged={load} />
              <PoliciesCard policies={policies} onSaved={load} />
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ── Self-service (everyone): my balance + request time off ────────────────────
interface MyBalance {
  leaveType: "sick" | "pto";
  balance: number;
  accrued: number;
  used: number;
}
interface Request {
  id: number;
  employeeId?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  hours: string;
  status: string;
  note: string;
  decidedBy: string;
  createdAt: string;
}
const LEAVE_LABEL: Record<string, string> = { sick: "Sick", pto: "PTO" };
const STATUS_CLS: Record<string, string> = {
  pending: "text-accent-fg bg-accent",
  approved: "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50",
  denied: "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800",
  cancelled: "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800",
};

function SelfServiceSection() {
  const [me, setMe] = useState<{ employeeId: string; name: string; jtUserId: string } | null | undefined>(undefined);
  const [balances, setBalances] = useState<MyBalance[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [meRes, reqRes] = await Promise.all([
        fetch("/api/time-off/me").then((r) => r.json()),
        fetch("/api/time-off/requests").then((r) => r.json()),
      ]);
      if (meRes.ok === false) setErr(meRes.error ?? "Failed to load your balance.");
      else {
        setMe(meRes.me ?? null);
        setBalances(meRes.balances ?? []);
        setPolicies(meRes.policies ?? []);
        setNote(meRes.note ?? "");
      }
      if (reqRes.ok !== false) setRequests(reqRes.requests ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <SectionLabel>My time off</SectionLabel>
      {err && <Banner tone="error" className="mt-2">{err}</Banner>}
      {me === undefined ? (
        <Loading label="Loading your balance…" />
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(["sick", "pto"] as const).map((t) => {
              const b = balances.find((x) => x.leaveType === t);
              return (
                <div key={t} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700/60">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{LEAVE_LABEL[t]}</div>
                  <div className="mt-0.5 text-2xl font-bold tabular-nums">{b ? hrs(b.balance) : "0"}</div>
                  <div className="text-[11px] text-neutral-500">hours available</div>
                </div>
              );
            })}
          </div>
          {note && <Banner tone="warning" className="mt-3">{note}</Banner>}
          {me && (
            <RequestForm policies={policies} onDone={load} />
          )}
          <MyRequests requests={requests} />
        </>
      )}
    </Card>
  );
}

function RequestForm({ policies, onDone }: { policies: Policy[]; onDone: () => void }) {
  const active = policies.filter((p) => p.active);
  const [leaveType, setLeaveType] = useState<"sick" | "pto">((active[0]?.leaveType as "sick" | "pto") ?? "sick");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  async function submit() {
    setErr("");
    const n = Number(hours);
    if (!startDate) return setErr("Pick a start date.");
    if (!Number.isFinite(n) || n <= 0) return setErr("Enter the number of hours.");
    setBusy(true);
    try {
      const res = await fetch("/api/time-off/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType, startDate, endDate: endDate || startDate, hours: n, note }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) setErr(json.error ?? "Failed.");
      else {
        setStartDate(""); setEndDate(""); setHours(""); setNote(""); setOpen(false);
        onDone();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button size="sm" onClick={() => setOpen(true)}>Request time off</Button>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700/60">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="req-type">Type</Label>
          <Select id="req-type" value={leaveType} onChange={(e) => setLeaveType(e.target.value as "sick" | "pto")}>
            {active.map((p) => (
              <option key={p.leaveType} value={p.leaveType}>{p.label || LEAVE_LABEL[p.leaveType]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="req-hrs">Hours</Label>
          <Input id="req-hrs" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 8" />
        </div>
        <div>
          <Label htmlFor="req-start">Start date</Label>
          <Input id="req-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="req-end">End date (optional)</Label>
          <Input id="req-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor="req-note">Note (optional)</Label>
        <Input id="req-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="reason / details" />
      </div>
      {err && <Banner tone="error" className="mt-2">{err}</Banner>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit request"}</Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${STATUS_CLS[status] ?? STATUS_CLS.denied}`}>
      {status}
    </span>
  );
}

function MyRequests({ requests }: { requests: Request[] }) {
  if (requests.length === 0) return null;
  return (
    <div className="mt-4">
      <SectionLabel className="mb-1">My requests</SectionLabel>
      <ul className="space-y-1.5">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700/60">
            <div className="min-w-0">
              <span className="font-medium">{LEAVE_LABEL[r.leaveType] ?? r.leaveType}</span>{" "}
              <span className="tabular-nums">{hrs(r.hours)} hr</span>{" "}
              <span className="text-neutral-500">
                · {r.startDate}
                {r.endDate && r.endDate !== r.startDate ? `–${r.endDate}` : ""}
              </span>
              {r.note && <span className="text-neutral-500"> · {r.note}</span>}
            </div>
            <StatusBadge status={r.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Office: pending-request approval queue ────────────────────────────────────
function RequestsQueueCard({ onChanged }: { onChanged: () => void }) {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "info" | "warning"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [reqRes, balRes] = await Promise.all([
        fetch("/api/time-off/requests?scope=all").then((r) => r.json()),
        fetch("/api/time-off/balances").then((r) => r.json()),
      ]);
      if (reqRes.ok === false) setErr(reqRes.error ?? "Failed to load requests.");
      else setRequests(reqRes.requests ?? []);
      if (balRes.ok !== false) {
        const m: Record<string, string> = {};
        for (const e of balRes.roster ?? []) m[e.employeeId] = e.name;
        setNames(m);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: number, action: "approve" | "deny") {
    setBusyId(id);
    setErr("");
    setMsg(null);
    try {
      const res = await fetch("/api/time-off/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) setErr(json.error ?? "Failed.");
      else {
        if (action === "approve") {
          if (json.jtPosted) setMsg({ tone: "success", text: "Approved and posted to JobTread." });
          else if (json.jtError) setMsg({ tone: "warning", text: `Approved, but the JobTread post failed: ${json.jtError}. Balance was still updated.` });
          else setMsg({ tone: "info", text: `Approved. JobTread: ${json.jtStatus || "not posted"}.` });
        }
        await load();
        onChanged();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  const pending = (requests ?? []).filter((r) => r.status === "pending");

  return (
    <Card>
      <SectionLabel>Requests {pending.length > 0 && <span className="text-accent">· {pending.length} pending</span>}</SectionLabel>
      {err && <Banner tone="error" className="mt-2">{err}</Banner>}
      {msg && <Banner tone={msg.tone} className="mt-2">{msg.text}</Banner>}
      {requests === null ? (
        <Loading label="Loading requests…" />
      ) : pending.length === 0 ? (
        <EmptyState className="mt-3">No pending requests.</EmptyState>
      ) : (
        <ul className="mt-3 space-y-2">
          {pending.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700/60">
              <div className="min-w-0">
                <span className="font-medium">{names[r.employeeId ?? ""] ?? "—"}</span>{" "}
                <span className="uppercase text-neutral-500">{LEAVE_LABEL[r.leaveType] ?? r.leaveType}</span>{" "}
                <span className="tabular-nums">{hrs(r.hours)} hr</span>{" "}
                <span className="text-neutral-500">· {r.startDate}{r.endDate && r.endDate !== r.startDate ? `–${r.endDate}` : ""}</span>
                {r.note && <div className="truncate text-xs text-neutral-500">{r.note}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "deny")}>Deny</Button>
                <Button size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>Approve</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Accrual run / preview ─────────────────────────────────────────────────────
function AccrualCard({
  onDone,
  setBanner,
}: {
  onDone: () => void;
  setBanner: (t: { note: string; error: string }) => void;
}) {
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [result, setResult] = useState<AccrualResult | null>(null);

  async function run(commit: boolean) {
    setBusy(commit ? "commit" : "preview");
    setResult(null);
    try {
      const res = await fetch("/api/time-off/accrual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setBanner({ note: "Accrual failed", error: json.error ?? "Unknown error" });
      } else {
        setBanner({ note: "", error: "" });
        setResult(json as AccrualResult);
        if (commit) onDone();
      }
    } catch (e) {
      setBanner({ note: "Accrual failed", error: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Accrual</SectionLabel>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => run(false)}>
            {busy === "preview" ? "Previewing…" : "Preview"}
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => run(true)}>
            {busy === "commit" ? "Running…" : "Run accrual"}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Earns hours from worked time in every completed pay period since each person last accrued.
        Preview shows what would post without saving; Run writes it. Safe to re-run — the same period
        never double-credits.
      </p>

      {result && (
        <div className="mt-3">
          <Banner tone={result.committed ? "success" : "info"}>
            {result.committed ? "Posted" : "Preview"} through {result.throughPeriod}:{" "}
            {TYPES.map((t) => `${result.totalsByType[t] ? hrs(result.totalsByType[t]) : "0"} ${t}`).join(
              " · ",
            )}{" "}
            hrs across {result.lines.length} period-lines.
          </Banner>
          {result.lines.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="py-1 pr-3">Employee</th>
                    <th className="py-1 pr-3">Period</th>
                    <th className="py-1 pr-3">Type</th>
                    <th className="py-1 pr-3 text-right">Worked</th>
                    <th className="py-1 pr-3 text-right">Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l, i) => (
                    <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1 pr-3">{l.name}</td>
                      <td className="py-1 pr-3 tabular-nums">{l.period}</td>
                      <td className="py-1 pr-3 uppercase">{l.leaveType}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{hrs(l.workedHours)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{hrs(l.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.skipped.length > 0 && (
            <Banner tone="warning" className="mt-2">
              Skipped {result.skipped.length}: {result.skipped.map((s) => `${s.name || s.employeeId} (${s.reason})`).join("; ")}
            </Banner>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Balances table + adjustments + ledger ─────────────────────────────────────
function BalancesCard({
  byEmployee,
  roster,
  onChanged,
}: {
  byEmployee: Array<[string, { name: string; sick?: Balance; pto?: Balance }]>;
  roster: RosterEmp[];
  onChanged: () => void;
}) {
  const [adjustFor, setAdjustFor] = useState<string>(""); // employeeId or "" (none)
  const [ledgerFor, setLedgerFor] = useState<string>("");

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Balances</SectionLabel>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAdjustFor((v) => (v === "new" ? "" : "new"))}
        >
          {adjustFor === "new" ? "Cancel" : "Adjust / import"}
        </Button>
      </div>

      {adjustFor === "new" && (
        <AdjustForm roster={roster} onDone={() => { setAdjustFor(""); onChanged(); }} />
      )}

      {byEmployee.length === 0 ? (
        <EmptyState className="mt-3">No balances yet. Run accrual or import opening balances.</EmptyState>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 pr-3">Employee</th>
                <th className="py-1 pr-3 text-right">Sick</th>
                <th className="py-1 pr-3 text-right">PTO</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {byEmployee.map(([empId, e]) => (
                <Fragment key={empId}>
                  <tr className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1.5 pr-3">{e.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.sick ? hrs(e.sick.balance) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.pto ? hrs(e.pto.balance) : "—"}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline"
                        onClick={() => setLedgerFor((v) => (v === empId ? "" : empId))}
                      >
                        {ledgerFor === empId ? "Hide" : "Ledger"}
                      </button>
                    </td>
                  </tr>
                  {ledgerFor === empId && (
                    <tr>
                      <td colSpan={4} className="pb-2">
                        <LedgerView employeeId={empId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AdjustForm({ roster, onDone }: { roster: RosterEmp[]; onDone: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState<"sick" | "pto">("sick");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    const n = Number(hours);
    if (!employeeId) return setErr("Pick an employee.");
    if (!Number.isFinite(n) || n === 0) return setErr("Enter a non-zero number of hours (negative to subtract).");
    setBusy(true);
    try {
      const emp = roster.find((r) => r.employeeId === employeeId);
      const res = await fetch("/api/time-off/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, jtUserId: emp?.jtUserId ?? "", leaveType, hours: n, note }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) setErr(json.error ?? "Failed.");
      else onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700/60">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="adj-emp">Employee</Label>
          <Select id="adj-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select…</option>
            {roster.map((r) => (
              <option key={r.employeeId} value={r.employeeId}>
                {r.name || r.employeeId}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="adj-type">Type</Label>
          <Select id="adj-type" value={leaveType} onChange={(e) => setLeaveType(e.target.value as "sick" | "pto")}>
            <option value="sick">Sick</option>
            <option value="pto">PTO</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="adj-hrs">Hours (± to add/subtract)</Label>
          <Input id="adj-hrs" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 40 or -8" />
        </div>
        <div>
          <Label htmlFor="adj-note">Note</Label>
          <Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opening balance import" />
        </div>
      </div>
      {err && <Banner tone="error" className="mt-2">{err}</Banner>}
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save adjustment"}
        </Button>
      </div>
    </div>
  );
}

function LedgerView({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch(`/api/time-off/ledger?employeeId=${encodeURIComponent(employeeId)}`)
      .then((r) => r.json())
      .then((j) => (j.ok === false ? setErr(j.error ?? "Failed.") : setRows(j.ledger ?? [])))
      .catch((e) => setErr(e instanceof Error ? e.message : "Network error"));
  }, [employeeId]);
  if (err) return <Banner tone="error">{err}</Banner>;
  if (!rows) return <Loading label="Loading ledger…" />;
  if (rows.length === 0) return <p className="px-1 py-2 text-xs text-neutral-500">No ledger entries.</p>;
  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-50 p-2 dark:bg-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wide text-neutral-500">
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1 pr-3">Kind</th>
            <th className="py-1 pr-3">Period</th>
            <th className="py-1 pr-3 text-right">Hours</th>
            <th className="py-1 pr-3">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-200/70 dark:border-neutral-700/60">
              <td className="py-1 pr-3 tabular-nums">{String(r.createdAt).slice(0, 10)}</td>
              <td className="py-1 pr-3 uppercase">{r.leaveType}</td>
              <td className="py-1 pr-3">{r.kind}</td>
              <td className="py-1 pr-3 tabular-nums">{r.period || "—"}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{hrs(r.hours)}</td>
              <td className="py-1 pr-3">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Policy editor ─────────────────────────────────────────────────────────────
function PoliciesCard({ policies, onSaved }: { policies: Policy[]; onSaved: () => void }) {
  return (
    <Card>
      <SectionLabel>Policies</SectionLabel>
      <p className="mt-1 text-xs text-neutral-500">
        Hours earned per hour worked, plus annual/carryover caps and the waiting period before leave
        may be used. Tenure tiers stay off unless configured.
      </p>
      <div className="mt-3 space-y-3">
        {policies.map((p) => (
          <PolicyRow key={p.leaveType} policy={p} onSaved={onSaved} />
        ))}
      </div>
    </Card>
  );
}

function PolicyRow({ policy, onSaved }: { policy: Policy; onSaved: () => void }) {
  const [rate, setRate] = useState(policy.hoursPerHourWorked);
  const [annualCap, setAnnualCap] = useState(policy.annualCap);
  const [carryoverCap, setCarryoverCap] = useState(policy.carryoverCap);
  const [waitingDays, setWaitingDays] = useState(String(policy.waitingDays));
  const [active, setActive] = useState(policy.active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setErr("");
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch("/api/time-off/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveType: policy.leaveType,
          hoursPerHourWorked: Number(rate) || 0,
          annualCap: Number(annualCap) || 0,
          carryoverCap: Number(carryoverCap) || 0,
          waitingDays: Number(waitingDays) || 0,
          active,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) setErr(json.error ?? "Failed.");
      else {
        setSaved(true);
        onSaved();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700/60">
      <div className="flex items-center justify-between">
        <div className="font-medium">{policy.label || policy.leaveType}</div>
        <Toggle checked={active} onChange={setActive} label={active ? "Active" : "Off"} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor={`rate-${policy.leaveType}`}>Rate (hr/hr)</Label>
          <Input id={`rate-${policy.leaveType}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          <p className="mt-1 text-[11px] text-neutral-500">{rateHint(Number(rate))}</p>
        </div>
        <div>
          <Label htmlFor={`ac-${policy.leaveType}`}>Annual cap</Label>
          <Input id={`ac-${policy.leaveType}`} inputMode="decimal" value={annualCap} onChange={(e) => setAnnualCap(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`co-${policy.leaveType}`}>Carryover cap</Label>
          <Input id={`co-${policy.leaveType}`} inputMode="decimal" value={carryoverCap} onChange={(e) => setCarryoverCap(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`wd-${policy.leaveType}`}>Waiting (days)</Label>
          <Input id={`wd-${policy.leaveType}`} inputMode="numeric" value={waitingDays} onChange={(e) => setWaitingDays(e.target.value)} />
        </div>
      </div>
      {err && <Banner tone="error" className="mt-2">{err}</Banner>}
      <div className="mt-2 flex items-center justify-end gap-2">
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        <Button size="sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
