"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { HomeJobBoard, JobOverview } from "@/components/HomeJobBoard";
import { HomeLeadBoard } from "@/components/HomeLeadBoard";
import { HomeTodos } from "@/components/HomeTodos";
import { TodayOfficeTodos } from "@/components/TodayOfficeTodos";
import { TodayQueue } from "@/components/TodayQueue";
import { WORKING_PHASES } from "@/components/JobPicker";
import { Donut } from "@/components/Donut";
import { LopezMap } from "@/components/LopezMap";
import { Card, Loading, Segmented, Skeleton } from "@/components/ui";
import { Board } from "@/app/trackingsheet/Board";
import { JobCard } from "@/app/job-board/JobBoardPage";
import { ClientsBrowser } from "@/app/clients/ClientsBrowser";
import { CustomerPopup } from "@/app/clients/CustomerPopup";
import { SyncAllTrackingSheetsFor } from "@/components/TrackingSheetSync";
import { BudgetImport } from "@/app/budget-import/BudgetImport";
import { Specs } from "@/app/specs/Specs";
import { HouseManualPage } from "@/app/house-manual/HouseManual";
import { monthJobRows, monthWarrantyRow, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import { WARRANTY_SLICE_KEY } from "@/lib/warranty";
import { billingMonths } from "@/lib/billingMonths";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";
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
type Tab = "sheet" | "schedule" | "plans" | "photos" | "record" | "budget" | "specs" | "manual";

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

/** The list's phase order: PreCon Budget before PreCon (owner, 2026-11-01). */
const LIST_PHASES = ["Active", "PreCon Budget", "PreCon"];

const caption =
  "text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

export function JobsHub() {
  const { can } = useAccess();
  const canTrackingSheet = can("recode");
  const [jobs, setJobs] = useState<HubJob[] | null>(null);
  const [defaultYm, setDefaultYm] = useState("");
  /** The Job Board's cards, by job id — address, number, schedule span, to-dos. */
  const [details, setDetails] = useState<Map<string, JobsPageCard> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** What the card shows while no job is picked: the month's rings, or Home's
   *  Leads or Active Jobs board (owner, 2026-11-02). */
  const [idleView, setIdleView] = useState<"month" | "leads" | "jobs">("month");
  /** The job whose customer the pop-up shows (owner, 2026-11-02). */
  const [customerOf, setCustomerOf] = useState<string | null>(null);
  /** The list row under the pointer: its dot lights on the map meanwhile. */
  const [hoverId, setHoverId] = useState<string | null>(null);
  // A ring slice lit a row the list may have scrolled past: bring it into view.
  useEffect(() => {
    if (hoverId)
      document
        .querySelector(`[data-job="${CSS.escape(hoverId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [hoverId]);
  const [tab, setTab] = useState<Tab>(canTrackingSheet ? "sheet" : "schedule");
  /** Where the Tracking sheet draws its to-be-invoiced figure and rings: the
   *  job card, beside the map (owner, 2026-11-01). */
  const [summarySlot, setSummarySlot] = useState<HTMLElement | null>(null);
  /** …and the rings' month / job-to-date switch, under the month picker. */
  const [scopeSlot, setScopeSlot] = useState<HTMLElement | null>(null);

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
  // No outline: it sits in the card's top right corner, a word you can change
  // (owner, 2026-11-01).
  const monthSelect = (
    <select
      aria-label="Month"
      value={ym}
      onChange={(e) => setPickedYm(e.target.value)}
      className="cursor-pointer rounded-md bg-transparent py-1 text-right text-[13px] font-semibold text-neutral-600 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 dark:text-neutral-300"
    >
      {months.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
  const { jobs: monthJobs } = useMonthJobs(ym);

  // Each client job's month: bills and labor, sales tax and warranty out.
  const ranked = useMemo(
    () =>
      monthJobs
        ? twoFamilies(monthJobRows(monthJobs.filter((j) => !isAscentOwn(j.customerName))))
        : null,
    [monthJobs],
  );
  const byJob = useMemo(() => new Map((ranked ?? []).map((r) => [r.key, r])), [ranked]);
  // The all-jobs rings: every client job, plus the month's warranty work on
  // those jobs as one grey slice — in the month's total, on no job.
  const ringItems = useMemo(() => {
    if (!ranked || !monthJobs) return ranked;
    const w = monthWarrantyRow(monthJobs.filter((j) => !isAscentOwn(j.customerName)));
    return w ? [...ranked, { ...w, laborColor: w.color }] : ranked;
  }, [ranked, monthJobs]);
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
      const i = LIST_PHASES.indexOf(p);
      return i < 0 ? LIST_PHASES.length : i;
    };
    return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [listed]);

  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  // A new job or tab unmounts the view under the header, so an embedded page's
  // unsaved edits (the House Manual) would go without a word. Ask first.
  const pick = (id: string) => {
    if (!confirmLeaveIfDirty()) return;
    setSelectedId((cur) => (cur === id ? null : id));
  };
  const files = useJobFiles(selected && (tab === "plans" || tab === "photos") ? selected.id : null);

  // Switching tabs swaps a tall view for one still loading, so the page would
  // shrink and the browser pull the view up. Hold the page at its height
  // through the switch and put the scroll back; a new job lets go.
  const mainRef = useRef<HTMLElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  const switchTab = (t: Tab) => {
    if (t === tab || !confirmLeaveIfDirty()) return;
    const y = window.scrollY;
    setHeldHeight(mainRef.current?.offsetHeight);
    setTab(t);
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  };
  useEffect(() => setHeldHeight(undefined), [selectedId]);

  // The map, right of the cards, the full height of the row the list sets,
  // with little room around the island (owner, 2026-11-01).
  const map = (
    <div className="h-full w-full [&_svg]:min-h-0 [&_svg]:flex-1">
      {jobs ? (
        <LopezMap
          jobs={jobs}
          selectedId={hoverId ?? selectedId}
          focusId={selectedId}
          onSelect={pick}
          legend={false}
          pad={6}
          className="h-full"
        />
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
        // The job's own pages, drawn here instead of opened (owner, 2026-11-02).
        // Each shows only to someone who holds its view.
        ...(can("clients") ? [{ value: "record" as const, label: "Job Details" }] : []),
        ...(can("budget-import") ? [{ value: "budget" as const, label: "Budget Import" }] : []),
        ...(can("specs") ? [{ value: "specs" as const, label: "Specifications" }] : []),
        ...(can("house-manual") ? [{ value: "manual" as const, label: "House Manual" }] : []),
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
        <div className="grid gap-6 xl:h-[360px] xl:grid-cols-[320px_minmax(0,1fr)_280px] xl:grid-rows-[minmax(0,1fr)]">
          {/* The row is 360px (owner, 2026-11-01); the list scrolls inside it. */}
          <Card pad={false} className="flex min-h-0 min-w-0 flex-col overflow-hidden p-3">
            {!jobs && <Loading />}
            <div className="max-h-80 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 xl:max-h-none">
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
                            data-job={j.id}
                            onMouseEnter={() => setHoverId(j.id)}
                            onMouseLeave={() => setHoverId(null)}
                            aria-pressed={j.id === selectedId}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-line-soft ${j.id === selectedId ? "bg-accent/10 font-semibold shadow-[inset_3px_0_0_rgb(var(--accent))]" : j.id === hoverId ? "bg-line-soft" : ""}`}
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

          {/* The second card, with the month picker in its top right corner. */}
          <div className="relative min-h-0 min-w-0">
            {selected ? (
              details?.get(selected.id) ? (
                <JobCard
                  c={details.get(selected.id)!}
                  footer={tabs}
                  nameLink={false}
                  onCustomer={can("clients") ? () => setCustomerOf(selected.id) : undefined}
                  aside={
                    <div className="flex h-full items-start gap-6">
                      {tab === "sheet" && canTrackingSheet && (
                        <div
                          ref={setSummarySlot}
                          className="h-full w-[520px] min-w-0 overflow-y-auto"
                        />
                      )}
                    </div>
                  }
                />
              ) : details ? (
                <Card />
              ) : (
                <Skeleton className="h-40 w-full rounded-xl" />
              )
            ) : (
              // The list's height, with the tabs on their own row at the foot,
              // as on a picked job's card.
              <Card className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                  {idleView === "leads" ? (
                    <HomeLeadBoard storeAs="jobs-hub" />
                  ) : idleView === "jobs" ? (
                    <HomeJobBoard />
                  ) : ringItems ? (
                    <div className="flex flex-col gap-3">
                      <MonthRings
                        items={ringItems}
                        onSelect={(id) => id !== WARRANTY_SLICE_KEY && pick(id)}
                        onHover={(id) => setHoverId(id === WARRANTY_SLICE_KEY ? null : id)}
                      />
                    </div>
                  ) : (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  )}
                </div>
                <div className="flex shrink-0 justify-center border-t border-line-soft pt-3">
                  <Segmented
                    label="Show"
                    value={idleView}
                    onChange={setIdleView}
                    options={[
                      { value: "month" as const, label: "This month" },
                      ...(can("leads") ? [{ value: "leads" as const, label: "Leads" }] : []),
                      { value: "jobs" as const, label: "Active Jobs" },
                    ]}
                  />
                </div>
              </Card>
            )}
            <div className="absolute right-4 top-3 z-10 flex items-center gap-4">
              {/* Sync, left of the month it syncs (owner, 2026-11-02): the
                  Tracking Sheets page's own — every wired sheet and the
                  month's Labor Report. */}
              {selected && ym && <SyncAllTrackingSheetsFor ym={ym} className="max-w-56 text-right" />}
              <div className="flex flex-col items-end gap-1">
                {selected && tab === "sheet" && <div ref={setScopeSlot} />}
                {(selected || idleView === "month") && monthSelect}
              </div>
            </div>
          </div>
          {/* The map, on the page beside the cards (owner, 2026-11-01). */}
          <div className="min-h-64 xl:min-h-0">{map}</div>
        </div>


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
              <Board key={`${selected.id}-${ym}`} embed={{ jobId: selected.id, ym, summarySlot, scopeSlot }} />
            </Suspense>
          )
        ) : tab === "plans" ? (
          <JobPlans state={files} />
        ) : tab === "photos" ? (
          <JobPhotos state={files} />
        ) : tab === "record" && can("clients") ? (
          <ClientsBrowser key={selected.id} jobId={selected.id} />
        ) : tab === "budget" && can("budget-import") ? (
          <BudgetImport key={selected.id} embedJobId={selected.id} />
        ) : tab === "specs" && can("specs") ? (
          <Suspense fallback={null}>
            <Specs key={selected.id} embedJobId={selected.id} />
          </Suspense>
        ) : tab === "manual" && can("house-manual") ? (
          <Suspense fallback={null}>
            <HouseManualPage key={selected.id} embedJobId={selected.id} />
          </Suspense>
        ) : (
          /* Keyed so a new job starts its own fetch rather than showing the last one's. */
          <JobOverview key={selected.id} jobId={selected.id} />
        )}
      </div>
      {customerOf && (
        <CustomerPopup
          jobId={customerOf}
          onClose={() => setCustomerOf(null)}
          onOpenJob={(id) => {
            if (id !== selectedId) pick(id);
          }}
        />
      )}
    </main>
  );
}

/**
 * The rings' colours (owner, 2026-11-01): Bills warm and Labor cool, so the
 * two rings never read as one — Tableau 20's warm and cool halves, distinct
 * hues that read on the light and the dark card. A job keeps the same slot in
 * both (its rank by the month's total). ponytail: 8 slots per family; colours
 * repeat from the 9th job, and a slice names its job on hover.
 */
const BILL_COLORS = [
  "#F28E2B",
  "#E15759",
  "#EDC948",
  "#FF9D9A",
  "#B6992D",
  "#FFBE7D",
  "#9D7660",
  "#D37295",
];
const LABOR_COLORS = [
  "#4E79A7",
  "#59A14F",
  "#76B7B2",
  "#A0CBE8",
  "#8CD17D",
  "#499894",
  "#B07AA1",
  "#86BCB6",
];
function twoFamilies<T extends { color: string }>(rows: T[]): (T & { laborColor: string })[] {
  return rows.map((r, i) => ({
    ...r,
    color: BILL_COLORS[i % BILL_COLORS.length],
    laborColor: LABOR_COLORS[i % LABOR_COLORS.length],
  }));
}

/**
 * No job picked: the month's Bills ring and Labor ring, a slice per job, with
 * the Total and then Bills · Labor beside them. A slice names its job with its
 * bills and labor on hover, and opens it on a click.
 */
function MonthRings({
  items,
  onSelect,
  onHover,
}: {
  items: {
    key: string;
    label: string;
    bills: number;
    labor: number;
    color: string;
    laborColor: string;
  }[];
  onSelect: (key: string) => void;
  /** The lifted slice's job, lit in the list and on the map meanwhile. */
  onHover: (key: string | null) => void;
}) {
  const detail = (key: string) => {
    const r = items.find((x) => x.key === key);
    return r
      ? [
          { key: "bills", label: "Bills", value: r.bills },
          { key: "labor", label: "Labor", value: r.labor },
        ]
      : [];
  };
  const bills = items.reduce((n, r) => n + r.bills, 0);
  const labor = items.reduce((n, r) => n + r.labor, 0);
  const slices = (field: "bills" | "labor") =>
    items
      .filter((r) => r[field] > 0)
      .map((r) => ({
        key: r.key,
        label: r.label,
        value: r[field],
        color: field === "labor" ? r.laborColor : r.color,
      }));
  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="tabular-nums">
        <div className={caption}>All jobs · month</div>
        <div className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
          {money0(bills + labor)}
        </div>
        <div className="text-[13px] text-neutral-500 dark:text-neutral-400">
          Bills {money0(bills)} · Labor {money0(labor)}
        </div>
      </div>
      <div className="flex gap-8">
        <Donut
          title="Bills"
          slices={slices("bills")}
          emptyLabel="No bills"
          size={150}
          legend={false}
          onSelect={onSelect}
          detail={detail}
          onHover={onHover}
        />
        <Donut
          title="Labor"
          slices={slices("labor")}
          emptyLabel="No labor"
          size={150}
          legend={false}
          onSelect={onSelect}
          detail={detail}
          onHover={onHover}
        />
      </div>
    </div>
  );
}
