"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Loading,
  MetaLine,
  PageHeader,
  Segmented,
  Select,
  Textarea,
  Toggle,
  tableCls,
} from "@/components/ui";
import { toast } from "@/components/Toast";
import { money } from "@/lib/money";
import { clockOfMinutes, minutesOfClock, orgParts, prettyClock, spanHours } from "@/lib/orgTime";
import { setUrlParam } from "@/lib/urlParam";
import {
  PERIOD_KINDS,
  isIsoDay,
  periodLabel,
  periodOf,
  stepAnchor,
  type PeriodKind,
} from "@/lib/laborPeriod";
import { AddTimeCard } from "@/app/trackingsheet/AddTimeCard";
import { laborOptions } from "@/app/trackingsheet/TimeCodingCard";
import { hoursLabel } from "@/app/trackingsheet/boardMath";

/**
 * THE LABOR PAGE — the weekly, half-month and monthly labor review on one
 * screen: every job's time entries for the period, grouped job → employee →
 * cost code, with each entry's pay type, rate and note in line.
 *
 * Reads /api/labor (the org-wide month read, cut to the period). Every write
 * reuses a route Tracking Sheets already uses: an edit or an approval is
 * POST /api/time-entry, a new entry is POST /api/time-entry/create (through
 * the board's own AddTimeCard). Those write immediately, so nothing is staged
 * here and nothing needs a Save. The budget columns read /api/jobs/cost-detail.
 */

interface Entry {
  id: string;
  date: string;
  employee: string;
  userId: string;
  startedAt: string | null;
  endedAt: string | null;
  hours: number;
  cost: number;
  hourlyRate: number;
  type: string;
  code: string;
  codeName: string;
  costItemId: string | null;
  notes: string;
  isApproved: boolean;
  jobId: string;
  jobName: string;
}

interface BudgetLeaf {
  id: string;
  number: string;
  name: string;
  detail?: string;
  costType?: string;
  cost?: number;
}

interface UserRef {
  id: string;
  name: string;
  types?: { name: string; hourlyRate?: number }[];
}

interface CostCode {
  number: string;
  name: string;
  labor: number;
  laborHours: number;
  split: { labor: number };
}
interface CostDetail {
  divisions: { codes: CostCode[] }[];
}

const KIND_LABEL: Record<PeriodKind, string> = { week: "Week", half: "Half month", month: "Month" };

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

function spanLabel(e: Entry): string {
  const s = orgParts(e.startedAt).time;
  const t = orgParts(e.endedAt).time;
  if (!s) return "";
  return t ? `${prettyClock(s)} – ${prettyClock(t)}` : `${prettyClock(s)} – running`;
}

const sum = (xs: Entry[], k: "hours" | "cost") => xs.reduce((a, e) => a + (e[k] || 0), 0);

/** Group by a key, keeping first-seen order. */
function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return [...m.entries()];
}

function todayOrg(): string {
  return orgParts(new Date().toISOString()).date;
}

export function LaborClient() {
  const params = useSearchParams();

  const [kind, setKind] = useState<PeriodKind>(() => {
    const k = params.get("period") as PeriodKind | null;
    if (k && PERIOD_KINDS.includes(k)) return k;
    return params.get("ym") ? "month" : "week";
  });
  const [anchor, setAnchor] = useState(() => {
    const d = params.get("date");
    if (isIsoDay(d)) return d;
    const ym = params.get("ym");
    if (ym && isIsoDay(`${ym}-01`)) return `${ym}-01`;
    return todayOrg();
  });
  const [jobId, setJobId] = useState(params.get("jobId") ?? "");
  const [pickedJob, setPickedJob] = useState<JobRef | null>(null);
  const [showBudget, setShowBudget] = useState(false);

  const { from, to } = periodOf(kind, anchor);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [writes, setWrites] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // The period and job live in the address bar, so a reload or a shared link
  // opens the same review. The anchor is stored as the period's first day.
  useEffect(() => {
    setUrlParam("period", kind);
    setUrlParam("date", from);
    setUrlParam("ym", "");
    setUrlParam("jobId", jobId);
  }, [kind, from, jobId]);

  useEffect(() => {
    let alive = true;
    setError("");
    fetch(`/api/labor?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        if (b.error) {
          setError(b.error);
          setEntries([]);
        } else {
          setEntries(b.entries as Entry[]);
          setWrites(Boolean(b.writesEnabled));
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, [from, to, reloadKey]);

  /* ---- per-job budget leaves (the legal codes for an edit or a new entry) ---- */
  const [leaves, setLeaves] = useState<Record<string, BudgetLeaf[]>>({});
  const loadLeaves = useCallback(
    (id: string) => {
      if (!id || leaves[id]) return;
      fetch(`/api/time-entry?jobId=${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((b) => setLeaves((m) => ({ ...m, [id]: (b.budget ?? []) as BudgetLeaf[] })))
        .catch(() => setLeaves((m) => ({ ...m, [id]: [] })));
    },
    [leaves],
  );

  /* ---- the roster with each person's pay types, loaded on the first edit ---- */
  const [roster, setRoster] = useState<{ users: UserRef[]; orgTypes: string[] } | null>(null);
  const loadRoster = useCallback(() => {
    if (roster) return;
    fetch("/api/time-entry/create", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setRoster({ users: b.users ?? [], orgTypes: b.orgTypes ?? [] }))
      .catch(() => setRoster({ users: [], orgTypes: [] }));
  }, [roster]);

  /* ---- labor budget per job, read only when the budget columns are on ---- */
  const [budgets, setBudgets] = useState<Record<string, Map<string, CostCode> | "error">>({});

  const shown = useMemo(
    () => (entries ?? []).filter((e) => !jobId || e.jobId === jobId),
    [entries, jobId],
  );

  const jobs = useMemo(() => {
    const sorted = [...shown].sort(
      (a, b) =>
        a.jobName.localeCompare(b.jobName) ||
        a.employee.localeCompare(b.employee) ||
        a.code.localeCompare(b.code, undefined, { numeric: true }) ||
        String(a.startedAt).localeCompare(String(b.startedAt)),
    );
    const out = groupBy(sorted, (e) => e.jobId);
    // A picked job with nothing in the period still gets its card, so time can
    // be added to it.
    if (jobId && out.length === 0) out.push([jobId, []]);
    return out;
  }, [shown, jobId]);

  useEffect(() => {
    if (!showBudget) return;
    for (const [id] of jobs) {
      if (!id || budgets[id]) continue;
      setBudgets((m) => ({ ...m, [id]: new Map() }));
      fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((d: CostDetail & { error?: string }) => {
          if (d.error) throw new Error(d.error);
          const map = new Map<string, CostCode>();
          for (const div of d.divisions ?? []) for (const c of div.codes) map.set(c.number, c);
          setBudgets((m) => ({ ...m, [id]: map }));
        })
        .catch(() => setBudgets((m) => ({ ...m, [id]: "error" })));
    }
  }, [showBudget, jobs, budgets]);

  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState("");
  const [approving, setApproving] = useState("");

  async function approve(e: Entry) {
    setApproving(e.id);
    try {
      const r = await fetch("/api/time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, isApproved: true }),
      });
      const b = await r.json();
      if (b.error) toast(b.error, { tone: "error" });
      else if (b.previewed) toast(b.message, { tone: "error" });
      else {
        toast("Approved");
        setEntries((xs) => xs?.map((x) => (x.id === e.id ? { ...x, isApproved: true } : x)) ?? xs);
      }
    } finally {
      setApproving("");
    }
  }

  const totalHours = sum(shown, "hours");
  const totalCost = sum(shown, "cost");
  const unapproved = shown.filter((e) => !e.isApproved).length;
  const jobName = (id: string, list: Entry[]) =>
    list[0]?.jobName ?? (pickedJob && pickedJob.id === id ? jobLabel(pickedJob) : "This job");

  return (
    <main className="w-full max-w-7xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader
        title="Labor"
        description="Review each job's time by employee, cost code and pay rate. Fix or add entries in place."
      />

      {/* ---- the period and the job ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Review period"
          value={kind}
          onChange={setKind}
          options={PERIOD_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous period" onClick={() => setAnchor(stepAnchor(kind, anchor, -1))}>
            ←
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-semibold tabular-nums">
            {periodLabel(kind, from, to)}
          </span>
          <Button variant="ghost" size="sm" aria-label="Next period" onClick={() => setAnchor(stepAnchor(kind, anchor, 1))}>
            →
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(todayOrg())}>
            Today
          </Button>
        </div>
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <JobPicker
            value={jobId}
            onChange={setJobId}
            onSelect={setPickedJob}
            onResolved={setPickedJob}
            allDescription="Every job's time in the period"
            showPhaseFilter
          />
        </div>
        <Toggle checked={showBudget} onChange={setShowBudget} label="Budget" />
      </div>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}
      {entries && !writes && (
        <Banner tone="warning" className="mb-3">
          Writes are off, so edits and new time are not sent to JobTread.
        </Banner>
      )}

      {entries === null ? (
        <Loading label="Loading the period's labor…" />
      ) : (
        <>
          <MetaLine
            className="mb-3"
            items={[
              `${shown.length} ${shown.length === 1 ? "entry" : "entries"}`,
              hoursLabel(totalHours),
              money(totalCost),
              unapproved ? <span className="text-warn">{unapproved} not approved</span> : "all approved",
            ]}
          />
          {jobs.length === 0 && (
            <EmptyState>No time in this period. Pick a job above to add time to it.</EmptyState>
          )}
          <div className="space-y-4">
            {jobs.map(([jid, list]) => (
              <JobCard
                key={jid || "none"}
                jobId={jid}
                name={jobName(jid, list)}
                list={list}
                writes={writes}
                budget={showBudget ? budgets[jid] ?? new Map() : null}
                leaves={leaves[jid]}
                roster={roster}
                editing={editing}
                adding={adding === jid}
                approving={approving}
                onEdit={(e) => {
                  setEditing(e.id);
                  loadLeaves(e.jobId);
                  loadRoster();
                }}
                onCancelEdit={() => setEditing("")}
                onAdd={() => {
                  setAdding(jid);
                  loadLeaves(jid);
                }}
                onCancelAdd={() => setAdding("")}
                onApprove={approve}
                onSaved={() => {
                  setEditing("");
                  setBudgets({});
                  reload();
                }}
                ym={from.slice(0, 7)}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ one job */

function JobCard({
  jobId,
  name,
  list,
  writes,
  budget,
  leaves,
  roster,
  editing,
  adding,
  approving,
  onEdit,
  onCancelEdit,
  onAdd,
  onCancelAdd,
  onApprove,
  onSaved,
  ym,
}: {
  jobId: string;
  name: string;
  list: Entry[];
  writes: boolean;
  budget: Map<string, CostCode> | "error" | null;
  leaves: BudgetLeaf[] | undefined;
  roster: { users: UserRef[]; orgTypes: string[] } | null;
  editing: string;
  adding: boolean;
  approving: string;
  onEdit: (e: Entry) => void;
  onCancelEdit: () => void;
  onAdd: () => void;
  onCancelAdd: () => void;
  onApprove: (e: Entry) => void;
  onSaved: () => void;
  ym: string;
}) {
  const options = useMemo(
    () => (leaves ? laborOptions(leaves, list.map((e) => e.costItemId)) : []),
    [leaves, list],
  );
  const byCode = useMemo(() => groupBy(list, (e) => e.code || "—"), [list]);

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-3 py-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h2>
        <span className="text-sm font-semibold tabular-nums">
          {hoursLabel(sum(list, "hours"))} · {money(sum(list, "cost"))}
        </span>
        {jobId && (
          <>
            <Link
              href={`/jobs-hub?jobId=${encodeURIComponent(jobId)}&ym=${ym}`}
              className="text-xs font-semibold text-neutral-500 transition hover:text-accent"
            >
              Tracking sheet ↗
            </Link>
            <Button size="xs" variant="secondary" onClick={onAdd} disabled={adding}>
              + Add time
            </Button>
          </>
        )}
      </div>

      {adding && (
        <div className="border-b border-line-soft p-3">
          {leaves ? (
            <AddTimeCard
              jobId={jobId}
              jobLabel={name}
              codeOptions={options}
              writes={writes}
              onSaved={() => {
                onCancelAdd();
                onSaved();
              }}
              onClose={onCancelAdd}
            />
          ) : (
            <Loading label="Loading the job's cost codes…" />
          )}
        </div>
      )}

      {budget && byCode.length > 0 && (
        <div className="overflow-x-auto border-b border-line-soft">
          {budget === "error" ? (
            <p className="px-3 py-2 text-xs text-danger">The job's budget did not load.</p>
          ) : (
            <table className={tableCls.root}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Cost code</th>
                  <th className={tableCls.thNum}>This period</th>
                  <th className={tableCls.thNum}>Labor to date</th>
                  <th className={tableCls.thNum}>Labor budget</th>
                  <th className={tableCls.thNum}>Left</th>
                </tr>
              </thead>
              <tbody>
                {byCode.map(([code, rows]) => {
                  const c = budget.get(code);
                  const left = c ? c.split.labor - c.labor : null;
                  return (
                    <tr key={code} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        {code} {rows[0].codeName}
                      </td>
                      <td className={tableCls.tdNum}>{money(sum(rows, "cost"))}</td>
                      <td className={tableCls.tdNum}>{c ? money(c.labor) : "…"}</td>
                      <td className={tableCls.tdNum}>{c ? money(c.split.labor) : "…"}</td>
                      <td className={`${tableCls.tdNum} ${left != null && left < 0 ? "text-danger" : ""}`}>
                        {left == null ? "…" : money(left)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {groupBy(list, (e) => e.employee).map(([employee, rows]) => (
        <section key={employee} className="border-b border-line-soft last:border-0">
          <div className="flex items-baseline gap-2 bg-neutral-50 px-3 py-2 dark:bg-white/5">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{employee}</h3>
            <span className="text-xs font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
              {hoursLabel(sum(rows, "hours"))} · {money(sum(rows, "cost"))}
            </span>
          </div>
          {groupBy(rows, (e) => `${e.code}|${e.costItemId}`).map(([key, codeRows]) => (
            <div key={key}>
              <div className="flex items-baseline gap-2 px-3 pb-1 pt-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-semibold text-neutral-600 dark:text-neutral-300">
                  {codeRows[0].code || "Uncoded"} {codeRows[0].codeName}
                </span>
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {hoursLabel(sum(codeRows, "hours"))} · {money(sum(codeRows, "cost"))}
                </span>
              </div>
              <div className="divide-y divide-line-soft">
                {codeRows.map((e) =>
                  editing === e.id ? (
                    <EntryEditor
                      key={e.id}
                      entry={e}
                      options={options}
                      loadingOptions={!leaves}
                      roster={roster}
                      writes={writes}
                      onCancel={onCancelEdit}
                      onSaved={onSaved}
                    />
                  ) : (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      writes={writes}
                      approving={approving === e.id}
                      onEdit={() => onEdit(e)}
                      onApprove={() => onApprove(e)}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </section>
      ))}
    </Card>
  );
}

/* ---------------------------------------------------------------- one entry */

function EntryRow({
  entry: e,
  writes,
  approving,
  onEdit,
  onApprove,
}: {
  entry: Entry;
  writes: boolean;
  approving: boolean;
  onEdit: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-sm md:grid-cols-[8rem_10rem_minmax(8rem,12rem)_4.5rem_5.5rem_minmax(0,1fr)_auto] md:items-baseline">
      <span className="font-medium">{dayLabel(e.date)}</span>
      <span className="text-right tabular-nums md:order-none md:text-left md:text-neutral-500">
        <span className="md:hidden">
          {hoursLabel(e.hours)} · {money(e.cost)}
        </span>
        <span className="hidden md:inline">{spanLabel(e)}</span>
      </span>
      <span className="col-span-2 text-xs text-neutral-500 md:col-span-1 md:text-sm dark:text-neutral-400">
        <span className="md:hidden">{spanLabel(e)} · </span>
        {e.type || "No pay type"}
        {e.hourlyRate ? ` @ ${money(e.hourlyRate)}/h` : ""}
      </span>
      <span className="hidden text-right tabular-nums md:block">{hoursLabel(e.hours)}</span>
      <span className="hidden text-right tabular-nums md:block">{money(e.cost)}</span>
      <span className="col-span-2 whitespace-pre-wrap break-words text-[13px] text-neutral-700 md:col-span-1 dark:text-neutral-300">
        {e.notes || <span className="text-neutral-400">No note</span>}
      </span>
      <span className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
        {e.isApproved ? (
          <span className="text-xs text-ok">✓ Approved</span>
        ) : (
          <Button size="xs" variant="ghost" onClick={onApprove} disabled={!writes || approving}>
            {approving ? "Approving…" : "Approve"}
          </Button>
        )}
        <Button size="xs" variant="secondary" onClick={onEdit}>
          Edit
        </Button>
      </span>
    </div>
  );
}

/**
 * One entry's fields, edited in place. Sends only what changed to
 * POST /api/time-entry; a change to the day, start or end sends all three,
 * which is what that route needs. A new span or pay type changes the cost.
 */
function EntryEditor({
  entry: e,
  options,
  loadingOptions,
  roster,
  writes,
  onCancel,
  onSaved,
}: {
  entry: Entry;
  options: Option[];
  loadingOptions: boolean;
  roster: { users: UserRef[]; orgTypes: string[] } | null;
  writes: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const start0 = orgParts(e.startedAt);
  const end0 = orgParts(e.endedAt).time;
  const [leafId, setLeafId] = useState(e.costItemId ?? "");
  const [payType, setPayType] = useState(e.type);
  const [date, setDate] = useState(start0.date || e.date);
  const [start, setStart] = useState(start0.time);
  const [end, setEnd] = useState(end0);
  const [hoursText, setHoursText] = useState(e.hours.toFixed(2));
  const [notes, setNotes] = useState(e.notes);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const user = roster?.users.find((u) => u.id === e.userId);
  const payTypes = useMemo(() => {
    const names = user?.types?.length ? user.types.map((t) => t.name) : roster?.orgTypes ?? [];
    return e.type && !names.includes(e.type) ? [e.type, ...names] : names;
  }, [user, roster, e.type]);

  const timeChanged = date !== (start0.date || e.date) || start !== start0.time || end !== end0;
  const spanned = spanHours(start, end);
  const reTimed = timeChanged || payType !== e.type;

  function changeStart(v: string) {
    const s = minutesOfClock(v);
    const keep = spanHours(start, end);
    setStart(v);
    if (s != null && keep != null && end) setEnd(clockOfMinutes(s + keep * 60));
  }
  function changeEnd(v: string) {
    setEnd(v);
    const h = spanHours(start, v);
    if (h != null) setHoursText(h.toFixed(2));
  }
  function changeHours(v: string) {
    setHoursText(v);
    const h = Number(v);
    const s = minutesOfClock(start);
    if (s != null && Number.isFinite(h) && h > 0 && h <= 24) setEnd(clockOfMinutes(s + h * 60));
  }

  async function save() {
    const body: Record<string, unknown> = { id: e.id };
    if (leafId && leafId !== (e.costItemId ?? "")) body.costItemId = leafId;
    if (payType && payType !== e.type) body.type = payType;
    if (notes !== e.notes) body.notes = notes;
    if (timeChanged) Object.assign(body, { date, startTime: start, endTime: end });
    if (Object.keys(body).length === 1) return onCancel();
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (b.error) setMsg({ tone: "error", text: b.error });
      else if (b.previewed) setMsg({ tone: "info", text: b.message });
      else {
        toast("Saved");
        onSaved();
      }
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 bg-neutral-50 px-3 py-3 dark:bg-white/5">
      <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
        Editing {e.employee} · {dayLabel(e.date)}
      </p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_7rem_7rem_6rem]">
        <div>
          <Label>Cost code</Label>
          {loadingOptions ? (
            <Loading label="Loading codes…" />
          ) : (
            <CostCodeSelect options={options} value={leafId} onChange={setLeafId} />
          )}
        </div>
        <div>
          <Label htmlFor={`pt-${e.id}`}>Pay type</Label>
          <Select id={`pt-${e.id}`} value={payType} onChange={(ev) => setPayType(ev.target.value)} disabled={!roster}>
            {payTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`d-${e.id}`}>Date</Label>
          <Input id={`d-${e.id}`} type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </div>
        <div>
          <Label htmlFor={`s-${e.id}`}>Start</Label>
          <Input id={`s-${e.id}`} type="time" value={start} onChange={(ev) => changeStart(ev.target.value)} />
        </div>
        <div>
          <Label htmlFor={`e-${e.id}`}>End</Label>
          <Input id={`e-${e.id}`} type="time" value={end} onChange={(ev) => changeEnd(ev.target.value)} />
        </div>
        <div>
          <Label htmlFor={`h-${e.id}`}>Hours</Label>
          <Input
            id={`h-${e.id}`}
            type="number"
            inputMode="decimal"
            min="0"
            max="24"
            step="0.25"
            value={hoursText}
            onChange={(ev) => changeHours(ev.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`n-${e.id}`}>Note</Label>
        <Textarea id={`n-${e.id}`} rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
      </div>
      {reTimed && (
        <p className="text-[11px] text-warn">
          A new day, time or pay type changes this entry&apos;s cost in JobTread.
        </p>
      )}
      {msg && (
        <Banner tone={msg.tone} className="!py-1.5 !text-[11px]">
          {msg.text}
        </Banner>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!writes || saving || (timeChanged && !(spanned && spanned > 0))}>
          {saving ? "Saving…" : "Save to JobTread"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
