"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { JobOverview } from "@/components/HomeJobBoard";
import { HomeTodos } from "@/components/HomeTodos";
import { TodayOfficeTodos } from "@/components/TodayOfficeTodos";
import { TodayQueue } from "@/components/TodayQueue";
import { WORKING_PHASES } from "@/components/JobPicker";
import { LopezMap } from "@/components/LopezMap";
import { Card, Loading, Segmented, Select, Skeleton } from "@/components/ui";
import { Board } from "@/app/trackingsheet/Board";
import { JobCard } from "@/app/job-board/JobBoardPage";
import { monthJobRows, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import { billingMonths } from "@/lib/billingMonths";
import type { MapJob } from "@/lib/lopezMap";
import type { JobsPageCard } from "@/lib/jobBoard";
import { money0 } from "@/lib/money";

import { JobPhotos, JobPlans, useJobFiles } from "./JobFiles";

/**
 * Jobs — the desktop screen for every job at once (owner, 2026-11-01; the
 * Figma page is "Jobs — header v2" in "Ascent — Jobs Hub (desktop draft)").
 *
 *   • At the top, the header: two cards (owner, 2026-11-01). The jobs list,
 *     by phase, "Customer - Job" A–Z by last name, each with its month total,
 *     under the month picker. Beside it, the picked job's Job Board card with
 *     the Lopez Island map in its top right — or, with no job picked, the
 *     month's totals beside the map. Under them, a picked job's tabs.
 *   • Under the header: no job → Home's "Needs you" queue and to-dos; a job →
 *     the picked tab: Tracking sheet (the job's /trackingsheet, embedded whole
 *     but for its tabs and header), Schedule (the job's overview),
 *     Plans or Photos (the job's JobTread plan sheets and photos).
 *
 * A list row or a map dot picks the job; picking it again closes it.
 *
 * Every write is the embedded Tracking Sheet's own; nothing here writes.
 */

type HubJob = MapJob & { customer?: string | null };
type Tab = "sheet" | "schedule" | "plans" | "photos";

/** Ascent's own jobs — customer "Ascent" (Office, Shop, Electrical) — stay out of
 *  the list and the totals: overhead, not client work (owner, 2026-11-01). */
const isAscentOwn = (customer: string | null | undefined) =>
  (customer ?? "").trim().toLowerCase() === "ascent";
const jobLabel = (j: HubJob) => (j.customer ? `${j.customer} - ${j.name}` : j.name);
/**
 * The customer's sort name: the last word ("Kevin Berger" → Berger, "Bill and
 * Denise Dougall-Jackins" → Dougall-Jackins), or a company's first word
 * ("Moon Spring Farm LLC" → Moon). ponytail: a company without a suffix sorts
 * by its last word.
 */
const sortName = (customer: string | null | undefined) => {
  const w = (customer ?? "").trim().split(/\s+/);
  const last = w[w.length - 1] ?? "";
  return (/^(llc|inc|co|corp|ltd)\.?$/i.test(last) ? w[0] : last).toLowerCase();
};

const caption =
  "text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

export function JobsHub() {
  const canTrackingSheet = useAccess().can("recode");
  const [jobs, setJobs] = useState<HubJob[] | null>(null);
  const [defaultYm, setDefaultYm] = useState("");
  /** The Job Board's cards, by job id — address, number, schedule span, to-dos. */
  const [details, setDetails] = useState<Map<string, JobsPageCard> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(canTrackingSheet ? "sheet" : "schedule");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => !cancelled && setJobs([]));
    fetch("/api/job-board")
      .then((r) => r.json())
      .then(
        (d: {
          error?: string;
          active?: JobsPageCard[];
          precon?: JobsPageCard[];
          complete?: JobsPageCard[];
        }) => {
          if (cancelled) return;
          const all = [...(d.active ?? []), ...(d.precon ?? []), ...(d.complete ?? [])];
          setDetails(new Map(all.map((c) => [c.id, c])));
        },
      )
      .catch(() => !cancelled && setDetails(new Map()));
    // Only for the billing month's name: the month the rings open on.
    fetch("/api/jobs/to-be-invoiced")
      .then((r) => r.json())
      .then((d) => !cancelled && !d?.error && setDefaultYm(d.ym ?? ""))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The month: the billing month until someone picks another.
  const [pickedYm, setPickedYm] = useState<string | null>(null);
  const ym = pickedYm ?? defaultYm;
  const months = useMemo(() => billingMonths(), []);
  const monthSelect = (
    <div className="w-36 shrink-0">
      <Select aria-label="Month" value={ym} onChange={(e) => setPickedYm(e.target.value)}>
        {months.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </Select>
    </div>
  );
  const { jobs: monthJobs } = useMonthJobs(ym);

  // Each client job's month: bills and labor, sales tax out.
  const ranked = useMemo(
    () => (monthJobs ? monthJobRows(monthJobs.filter((j) => !isAscentOwn(j.customerName))) : null),
    [monthJobs],
  );
  const byJob = useMemo(() => new Map((ranked ?? []).map((r) => [r.key, r])), [ranked]);
  // The list: every working client job, and any other with cost this month.
  const listed = useMemo(
    () =>
      (jobs ?? [])
        .filter(
          (j) =>
            !isAscentOwn(j.customer) && (WORKING_PHASES.includes(j.phase ?? "") || byJob.has(j.id)),
        )
        .sort(
          (a, b) =>
            sortName(a.customer).localeCompare(sortName(b.customer)) ||
            jobLabel(a).localeCompare(jobLabel(b)),
        ),
    [jobs, byJob],
  );
  // Grouped by phase: the working phases in their usual order, then any other
  // phase a job with cost this month is in, A–Z (owner, 2026-11-01).
  const byPhase = useMemo(() => {
    const groups = new Map<string, HubJob[]>();
    for (const j of listed) {
      const p = j.phase || "No phase";
      groups.set(p, [...(groups.get(p) ?? []), j]);
    }
    const rank = (p: string) => {
      const i = WORKING_PHASES.indexOf(p);
      return i < 0 ? WORKING_PHASES.length : i;
    };
    return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [listed]);

  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  const pick = (id: string) => setSelectedId((cur) => (cur === id ? null : id));
  const files = useJobFiles(selected && (tab === "plans" || tab === "photos") ? selected.id : null);

  // Switching tabs swaps a tall view for one still loading, so the page would
  // shrink and the browser pull the view up. Hold the page at its height
  // through the switch and put the scroll back; a new job lets go.
  const mainRef = useRef<HTMLElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  const switchTab = (t: Tab) => {
    const y = window.scrollY;
    setHeldHeight(mainRef.current?.offsetHeight);
    setTab(t);
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  };
  useEffect(() => setHeldHeight(undefined), [selectedId]);

  const monthBills = ranked?.reduce((n, r) => n + r.bills, 0) ?? 0;
  const monthLabor = ranked?.reduce((n, r) => n + r.labor, 0) ?? 0;
  // The map, half its old size, in the second card's top right.
  const map = (
    <div className="w-[150px]">
      {jobs ? (
        <LopezMap jobs={jobs} selectedId={selectedId} onSelect={pick} legend={false} />
      ) : (
        <Loading />
      )}
    </div>
  );

  const tabs = (
    <Segmented
      label="Show"
      value={tab}
      onChange={switchTab}
      options={[
        ...(canTrackingSheet ? [{ value: "sheet" as const, label: "Tracking sheet" }] : []),
        { value: "schedule" as const, label: "Schedule" },
        { value: "plans" as const, label: "Plans" },
        { value: "photos" as const, label: "Photos" },
      ]}
    />
  );

  return (
    <main
      ref={mainRef}
      className="w-full px-4 pb-10 pt-5 pad:px-7"
      style={{ minHeight: heldHeight }}
    >
      <div className="min-w-0 space-y-6">
        {/* THE HEADER (owner, 2026-11-01): two cards — the jobs list, and the
            picked job's Job Board card with the map in its top right (the
            month's totals beside the map while no job is picked). */}
        <div className="grid items-start gap-6 xl:grid-cols-[25%_minmax(0,1fr)]">
          <Card pad={false} className="min-w-0 self-start p-3">
            {/* The month the totals, and the Tracking sheet below, are for. */}
            <div className="mb-2 flex justify-end">{monthSelect}</div>
            {!jobs && <Loading />}
            <div className="space-y-3">
              {byPhase.map(([phase, list]) => (
                <section key={phase}>
                  <div className={`px-2 pb-0.5 ${caption}`}>{phase}</div>
                  <ul className="space-y-px">
                    {list.map((j) => {
                      const r = byJob.get(j.id);
                      return (
                        <li key={j.id}>
                          <button
                            type="button"
                            onClick={() => pick(j.id)}
                            aria-pressed={j.id === selectedId}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-line-soft ${j.id === selectedId ? "bg-line-soft font-semibold" : ""}`}
                          >
                            <span className="min-w-0 flex-1 truncate">{jobLabel(j)}</span>
                            <span className="shrink-0 text-[12px] font-normal tabular-nums text-neutral-500 dark:text-neutral-400">
                              {r && r.bills + r.labor > 0 ? money0(r.bills + r.labor) : "—"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </Card>

          {selected ? (
            details?.get(selected.id) ? (
              <JobCard c={details.get(selected.id)!} aside={map} />
            ) : details ? (
              <Card className="flex justify-end">{map}</Card>
            ) : (
              <Skeleton className="h-40 w-full rounded-xl" />
            )
          ) : (
            <Card className="flex gap-4">
              <div className="min-w-0 flex-1 tabular-nums">
                <div className={caption}>All jobs · month</div>
                <div className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
                  {ranked ? money0(monthBills + monthLabor) : "—"}
                </div>
                <div className="text-[13px] text-neutral-500 dark:text-neutral-400">
                  Bills {money0(monthBills)} · Labor {money0(monthLabor)}
                </div>
              </div>
              {map}
            </Card>
          )}
        </div>

        {selected && <div className="overflow-x-auto">{tabs}</div>}

        {/* UNDER THE HEADER */}
        {!selected ? (
          <>
            {/* Home's "Needs you" queue and to-dos; each gates itself by view. */}
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="min-w-0">
                <TodayQueue />
              </div>
              <div className="min-w-0">
                <HomeTodos />
                <TodayOfficeTodos />
              </div>
            </div>
          </>
        ) : tab === "sheet" && canTrackingSheet ? (
          /* The job's Tracking Sheet, as /trackingsheet draws it, less its
             tabs and header. Keyed by job and month: a new pick is a fresh
             board. Staged coding survives it — the board restores unsynced
             work on load and says so. */
          ym && (
            <Suspense fallback={null}>
              <Board key={`${selected.id}-${ym}`} embed={{ jobId: selected.id, ym }} />
            </Suspense>
          )
        ) : tab === "plans" ? (
          <JobPlans state={files} />
        ) : tab === "photos" ? (
          <JobPhotos state={files} />
        ) : (
          /* Keyed so a new job starts its own fetch rather than showing the last one's. */
          <JobOverview key={selected.id} jobId={selected.id} />
        )}
      </div>
    </main>
  );
}
