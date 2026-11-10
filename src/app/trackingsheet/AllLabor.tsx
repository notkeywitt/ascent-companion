"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Card, Loading } from "@/components/ui";
import {
  TimeEntryList,
  TimeGroupSwitch,
  useTimeFilters,
  type GroupBy,
  type TimeEntryRow,
} from "@/components/TimeEntryList";
import { money } from "@/lib/money";
import { hoursLabel } from "./boardMath";
import { laborFocusHref } from "./findingFocus";

/**
 * THE MONTH'S LABOR, ALL JOBS — the labor card of a job's board, drawn over
 * every job at once on the all-jobs view (owner, 2026-11-10).
 *
 * Same list, same filters, same flag, same look: it renders the shared
 * TimeEntryList. Two things differ, because one month spans many budgets:
 *  - The cost-code chip carries no "left" figure. Headroom is per job.
 *  - A row opens the entry in ITS job's board for the month, narrowed to the
 *    person with the entry ticked, where it is edited and recoded. This list
 *    writes nothing to JobTread.
 *
 * `groupBy` is the page's Group choice (AllBills): Job groups by job, Vendor by
 * employee (labor's vendor is the person), None is flat. The card's own Group
 * switch still re-cuts it after that.
 */

const GROUP_FOR: Record<"none" | "vendor" | "job", GroupBy> = {
  none: "none",
  vendor: "employee",
  job: "job",
};

export function AllLabor({
  ym,
  groupBy,
}: {
  ym: string;
  groupBy: "none" | "vendor" | "job";
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<TimeEntryRow[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const [y, m] = ym.split("-");
    setEntries(null);
    setError("");
    setSelected(new Set());
    fetch(`/api/trackingsheet/all-time?year=${y}&month=${Number(m)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else setEntries((j.timeEntries ?? []) as TimeEntryRow[]);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, [ym]);

  const list = useMemo(() => entries ?? [], [entries]);
  const filters = useTimeFilters(list, { resetKey: ym, defaultGroupBy: GROUP_FOR[groupBy] });
  const { setGroupBy } = filters;
  // The page's Group choice re-cuts the labor list too.
  useEffect(() => setGroupBy(GROUP_FOR[groupBy]), [groupBy, setGroupBy]);

  const total = list.reduce((s, t) => s + t.cost, 0);
  const hours = list.reduce((s, t) => s + t.hours, 0);

  /** Every ticked entry, when they all sit on one job — the board recodes one job at a time. */
  const picked = list.filter((t) => selected.has(t.id));
  const pickedJobs = new Set(picked.map((t) => t.jobId ?? ""));
  const oneJob = pickedJobs.size === 1 ? [...pickedJobs][0] : "";

  const openOnBoard = (jobId: string, ids: string[], employee?: string) =>
    router.push(laborFocusHref(jobId, ym, { kind: "labor", employee, entryIds: ids }));

  if (error) {
    return (
      <Banner tone="error" className="mb-2">
        Labor: {error}
      </Banner>
    );
  }

  return (
    <Card pad={false} className="mb-2 overflow-hidden">
      <div className="flex w-full items-baseline gap-2 px-3 py-3 lg:py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={list.length === 0}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold transition hover:text-accent disabled:cursor-default disabled:hover:text-inherit"
        >
          <span
            aria-hidden
            className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
              open ? "rotate-90" : ""
            } ${list.length === 0 ? "opacity-0" : ""}`}
          >
            ▶
          </span>
          {entries === null
            ? "Labor"
            : `Labor (${list.length} ${list.length === 1 ? "entry" : "entries"})`}
        </button>
        {open && list.length > 0 && (
          <div className="shrink-0 self-center">
            <TimeGroupSwitch filters={filters} withJob />
          </div>
        )}
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {money(total)} · {hoursLabel(hours)}
        </span>
      </div>
      {entries === null && (
        <div className="border-t border-line-soft px-3 py-2">
          <Loading label="Loading this month’s labor…" />
        </div>
      )}
      {open && list.length > 0 && (
        <>
          <TimeEntryList
            filters={filters}
            hideGroup
            monthEntries={list}
            codeOf={(t) => t.code}
            isMoved={() => false}
            selected={selected}
            onSelectedChange={setSelected}
            onFlag={(id, flagged) => {
              const jobId = list.find((t) => t.id === id)?.jobId ?? "";
              setEntries((prev) => prev?.map((t) => (t.id === id ? { ...t, flagged } : t)) ?? prev);
              // Same endpoint and table as the job's own labor list.
              fetch("/api/labor-review/flag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, jobId, flagged }),
              }).catch(() => {});
            }}
            onEdit={(id) => {
              const t = list.find((x) => x.id === id);
              if (t?.jobId) openOnBoard(t.jobId, [t.id], t.employee);
            }}
          />
          {/* What the ticks are for: the job's board holds the recode drawer. */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-3 py-2 text-xs">
              {oneJob ? (
                <>
                  <span className="min-w-0 truncate text-neutral-500 dark:text-neutral-400">
                    {picked[0]?.jobName}
                  </span>
                  <button
                    type="button"
                    onClick={() => openOnBoard(oneJob, picked.map((t) => t.id))}
                    className="min-h-11 shrink-0 font-semibold text-accent hover:underline"
                  >
                    Recode on this job’s sheet →
                  </button>
                </>
              ) : (
                <span className="text-neutral-500 dark:text-neutral-400">
                  Tick entries from one job to recode them on its sheet.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
