"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  MetaLine,
  PageHeader,
  Segmented,
  Toggle,
  tableCls,
} from "@/components/ui";
import { toast } from "@/components/Toast";
import { money } from "@/lib/money";
import { orgParts, prettyClock } from "@/lib/orgTime";
import { setUrlParam } from "@/lib/urlParam";
import {
  PERIOD_KINDS,
  isIsoDay,
  periodLabel,
  periodOf,
  stepAnchor,
  type PeriodKind,
} from "@/lib/laborPeriod";
import { WeekCalendar } from "@/app/employee-time/WeekCalendar";
import type { Entry as WeekEntry, User } from "@/app/employee-time/WeekCompare";
import type { CostCodeDefault, PayTypeRule } from "@/lib/payTypeMatch";
import { AddTimeCard } from "@/app/trackingsheet/AddTimeCard";
import { laborOptions, type TimeEntryRow } from "@/app/trackingsheet/TimeCodingCard";
import { LaborImport } from "@/app/labor-import/LaborImport";
import { EntryPanel } from "./EntryPanel";
import { PayRateCheck } from "./PayRateCheck";
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

/** What the calendar view needs (the Time page's Split View inputs); null = not offered. */
export interface LaborCalendarData {
  users: User[];
  appUserIds: string[];
  myId: string;
  jobs: JobRef[];
  orgTypes: string[];
  payRules: PayTypeRule[];
  codeDefaults: CostCodeDefault[];
}

export function LaborClient({ calendar = null }: { calendar?: LaborCalendarData | null } = {}) {
  const [view, setView] = useState<"list" | "calendar">("list");
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
    // Internal jobs (Ascent Office, Shop) sink to the bottom of the list.
    const internal = (l: typeof shown) => /^(ascent office|shop)\b/i.test(l[0]?.jobName ?? "") ? 1 : 0;
    out.sort((a, b) => internal(a[1]) - internal(b[1]));
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

  const belowXl = useIsBelowXl();
  const [openId, setOpenId] = useState("");
  const [adding, setAdding] = useState("");
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
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

  const openEntry = shown.find((e) => e.id === openId) ?? null;
  const openRow: TimeEntryRow | null = openEntry && {
    ...openEntry,
    minutes: Math.round(openEntry.hours * 60),
  };
  const openOptions = useMemo(
    () =>
      openEntry && leaves[openEntry.jobId]
        ? laborOptions(leaves[openEntry.jobId], [openEntry.costItemId])
        : [],
    [openEntry, leaves],
  );
  const entryPanel = openRow && openEntry && (
    <EntryPanel
      key={openRow.id}
      entry={openRow}
      jobId={openEntry.jobId}
      codeOptions={openOptions}
      writes={writes}
      onSaved={() => {
        setOpenId("");
        setBudgets({});
        reload();
      }}
      onClose={() => setOpenId("")}
    />
  );

  const totalHours = sum(shown, "hours");
  const totalCost = sum(shown, "cost");
  const unapproved = shown.filter((e) => !e.isApproved).length;
  const jobName = (id: string, list: Entry[]) =>
    list[0]?.jobName ?? (pickedJob && pickedJob.id === id ? jobLabel(pickedJob) : "This job");

  const viewToggle = calendar && (
    <Segmented
      label="Labor view"
      className="mb-4"
      value={view}
      onChange={setView}
      options={[
        { value: "list" as const, label: "List" },
        { value: "calendar" as const, label: "Calendar" },
      ]}
    />
  );
  if (calendar && view === "calendar") {
    return (
      <main className="w-full max-w-7xl px-4 pad:px-7 pb-24 pt-6">
        <PageHeader title="Labor" />
        {viewToggle}
        <WeekCalendar
          {...calendar}
          renderPanel={({ entry: e, who, name, close, reload: reloadWeek }) => (
            <CalendarEntryPanel
              key={e.id}
              e={e}
              who={who}
              name={calendar.users.find((u) => u.id === who)?.name ?? name}
              writes={writes}
              leaves={leaves[e.jobId]}
              loadLeaves={loadLeaves}
              onSaved={() => {
                close();
                reloadWeek();
              }}
              onClose={close}
            />
          )}
        />
      </main>
    );
  }

  return (
    <main className="w-full max-w-7xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader title="Labor" />
      {viewToggle}

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
      <div className="min-w-0">
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
        <div className="mb-3 max-w-sm">
          <JobPicker
            value={jobId}
            onChange={setJobId}
            onSelect={setPickedJob}
            onResolved={setPickedJob}
            allDescription="Every job's time in the period"
            showPhaseFilter
          />
        </div>
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
                openId={openId}
                adding={adding === jid}
                approving={approving}
                onOpen={(e) => {
                  setOpenId(e.id);
                  loadLeaves(e.jobId);
                }}
                onAdd={() => {
                  setAdding(jid);
                  loadLeaves(jid);
                }}
                onCancelAdd={() => setAdding("")}
                onApprove={approve}
                onSaved={() => {
                  setBudgets({});
                  reload();
                }}
                ym={from.slice(0, 7)}
              />
            ))}
          </div>
        </>
      )}
      </div>

      {/* ---- the right column: a small utility menu over the entry's details ---- */}
      <aside className="order-first space-y-3 xl:sticky xl:top-4 xl:order-none">
        <Card className="flex flex-wrap items-center gap-2 !py-2">
          <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Tools
          </span>
          <Button size="xs" variant="secondary" onClick={() => setChecking(true)} disabled={!entries}>
            Check pay rates
          </Button>
          <Button size="xs" variant="secondary" onClick={() => setImporting(true)}>
            Import labor
          </Button>
          <Toggle checked={showBudget} onChange={setShowBudget} label="Budget" />
        </Card>
        {!belowXl &&
          (entryPanel || (
            <Card>
              <p className="text-sm font-semibold">Details</p>
              <p className="mt-1 text-xs text-neutral-500">Select a time entry to see and edit it here.</p>
            </Card>
          ))}
      </aside>
      </div>

      {belowXl && entryPanel && (
        <Dialog label="Edit time entry" bare onClose={() => setOpenId("")}>
          {entryPanel}
        </Dialog>
      )}
      {importing && (
        <Dialog label="Import labor" title="Import labor" size="xl" onClose={() => setImporting(false)}>
          <LaborImport embedded />
        </Dialog>
      )}
      {checking && (
        <PayRateCheck
          entries={shown}
          periodLabel={periodLabel(kind, from, to)}
          writes={writes}
          onChanged={reload}
          onClose={() => setChecking(false)}
        />
      )}
    </main>
  );
}

/**
 * The calendar's edit panel: a tapped block as the Tracking Sheet's time card.
 * The calendar's entry carries no cost code name, so the card shows the number.
 */
function CalendarEntryPanel({
  e,
  who,
  name,
  writes,
  leaves,
  loadLeaves,
  onSaved,
  onClose,
}: {
  e: WeekEntry;
  who: string;
  name: string;
  writes: boolean;
  leaves: BudgetLeaf[] | undefined;
  loadLeaves: (jobId: string) => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  useEffect(() => loadLeaves(e.jobId), [loadLeaves, e.jobId]);
  const options = useMemo(
    () => (leaves ? laborOptions(leaves, [e.costItemId]) : []),
    [leaves, e.costItemId],
  );
  if (!e.startedAt) {
    return (
      <Card>
        <p className="text-xs text-neutral-500">
          Saving this entry in JobTread — tap it again in a moment to edit.
        </p>
      </Card>
    );
  }
  const row: TimeEntryRow = {
    id: e.id,
    employee: name,
    startedAt: e.startedAt,
    endedAt: e.endedAt ?? null,
    hours: e.minutes / 60,
    minutes: e.minutes,
    cost: e.cost ?? 0,
    code: e.costCode,
    codeName: "",
    notes: e.notes,
    isApproved: e.approved,
    costItemId: e.costItemId || null,
    type: e.payType,
    userId: who,
  };
  return (
    <EntryPanel
      key={e.id}
      entry={row}
      jobId={e.jobId}
      codeOptions={options}
      writes={writes}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

function useIsBelowXl() {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const update = () => setBelow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return below;
}

/* ------------------------------------------------------------------ one job */

function JobCard({
  jobId,
  name,
  list,
  writes,
  budget,
  leaves,
  openId,
  adding,
  approving,
  onOpen,
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
  openId: string;
  adding: boolean;
  approving: string;
  onOpen: (e: Entry) => void;
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
            <p className="px-3 py-2 text-xs text-danger">The job&apos;s budget did not load.</p>
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
                {codeRows.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    open={openId === e.id}
                    writes={writes}
                    approving={approving === e.id}
                    onOpen={() => onOpen(e)}
                    onApprove={() => onApprove(e)}
                  />
                ))}
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
  open,
  writes,
  approving,
  onOpen,
  onApprove,
}: {
  entry: Entry;
  open: boolean;
  writes: boolean;
  approving: boolean;
  onOpen: () => void;
  onApprove: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={open}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          onOpen();
        }
      }}
      className={`grid cursor-pointer grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-sm md:grid-cols-[8rem_10rem_minmax(8rem,12rem)_4.5rem_5.5rem_minmax(0,1fr)] md:items-baseline ${
        open ? "bg-accent/10" : "hover:bg-neutral-50 dark:hover:bg-white/5"
      }`}
    >
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
      <span className="col-span-2 whitespace-pre-wrap break-words text-[13px] text-neutral-700 md:order-last md:col-span-full dark:text-neutral-300">
        {e.notes || <span className="text-neutral-400">No note</span>}
      </span>
      <span className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
        {e.isApproved ? (
          <span className="text-xs text-ok">✓ Approved</span>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={(ev) => {
              ev.stopPropagation();
              onApprove();
            }}
            disabled={!writes || approving}
          >
            {approving ? "Approving…" : "Approve"}
          </Button>
        )}
      </span>
    </div>
  );
}
