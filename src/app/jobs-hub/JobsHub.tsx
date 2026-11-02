"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Donut } from "@/components/Donut";

import { useAccess } from "@/components/AccessProvider";
import { JobOverview } from "@/components/HomeJobBoard";
import { HomeTodos } from "@/components/HomeTodos";
import { TodayOfficeTodos } from "@/components/TodayOfficeTodos";
import { TodayQueue } from "@/components/TodayQueue";
import { WORKING_PHASES } from "@/components/JobPicker";
import { LopezMap } from "@/components/LopezMap";
import { Card, Loading, Segmented, Select, Skeleton } from "@/components/ui";
import { buildColorMap, withoutSalesTax, type CostDonutRow } from "@/app/trackingsheet/CostDonuts";
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
 *   • At the top, the header — no job picker above it; the list is the
 *     picker (owner, 2026-11-01). Left: the Lopez Island map. Next to it: the
 *     jobs on their own card, by phase, "Customer - Job" A–Z by last name,
 *     each with its month total. That card's height is the row's; the rest
 *     sit on the page and scale to it. Right: the month's Bills and Labor
 *     rings with the totals under them — every job, or the picked job by cost
 *     code — and, once a job is picked, its Job Board card above the rings
 *     and the tabs below.
 *   • Under the header: no job → Home's "Needs you" queue and to-dos; a job →
 *     the picked tab: Tracking sheet (the job's /trackingsheet, embedded whole
 *     but for its tabs and header), Schedule (the job's overview),
 *     Plans or Photos (the job's JobTread plan sheets and photos).
 *
 * A list row, a ring slice or a map dot picks the job; picking it again closes it.
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

  // Each client job's month, ranked by total, in its two ring colours.
  const ranked = useMemo(
    () =>
      monthJobs
        ? twoFamilies(monthJobRows(monthJobs.filter((j) => !isAscentOwn(j.customerName))))
        : null,
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
  // The rings: every job's month, or the picked job's month by cost code.
  const selectedMonth = selected
    ? (monthJobs?.find((j) => j.jobId === selected.id)?.rows ?? (monthJobs ? [] : null))
    : null;
  const ringItems = selected ? selectedMonth && codeItems(selectedMonth) : ranked;
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
        {/* THE HEADER (owner, 2026-11-01): the jobs list on its own card sets
            the row's height; the middle and the map sit on the page and scale
            to it. */}
        <div className="grid gap-6 xl:grid-cols-[28.333%_25%_minmax(0,1fr)]">
          {/* The map, left of the list, at 85% of the row's height (owner,
              2026-11-01): it scales with the row the list sets. */}
          <div className="relative min-h-64">
            <div className="absolute inset-x-0 top-[7.5%] h-[85%] [&_svg]:min-h-0 [&_svg]:flex-1">
              {jobs ? (
                <LopezMap
                  jobs={jobs}
                  selectedId={selectedId}
                  onSelect={pick}
                  legend={false}
                  className="h-full"
                />
              ) : (
                <Loading />
              )}
            </div>
          </div>
          <Card pad={false} className="min-w-0 self-start p-3">
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

          <div className="flex min-w-0 flex-col gap-4">
            {selected && (
              /* The job's card from the Job Board page: who and where, the
                 schedule now, the newest open to-dos. */
              <>
                {details?.get(selected.id) ? (
                  <JobCard c={details.get(selected.id)!} />
                ) : details ? null : (
                  <Skeleton className="h-40 w-full rounded-xl" />
                )}
              </>
            )}
            <div className="flex items-center gap-3">
              <div className={`min-w-0 flex-1 truncate ${caption}`}>
                {selected ? "This job · by cost code" : "All jobs"}
              </div>
              {monthSelect}
            </div>
            {ringItems ? (
              <Rings items={ringItems} onSelect={selected ? undefined : pick} />
            ) : (
              <Skeleton className="min-h-[180px] w-full flex-1 rounded-xl" />
            )}
            {selected && <div className="overflow-x-auto">{tabs}</div>}
          </div>
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

/**
 * The rings' colours (owner, 2026-11-01): Bills and Labor each get a family of
 * their own so the two rings never read as one — Bills warm, Labor cool —
 * distinct hues rather than a gradient, which was hard to tell apart. Tableau
 * 20's warm and cool halves, so every slot reads on the light and the dark
 * card. A job keeps the same slot in both families (its rank by the month's
 * total). ponytail: 8 slots per family; colours repeat from the 9th job,
 * and a slice names its job on hover.
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

interface RingItem {
  key: string;
  label: string;
  bills: number;
  labor: number;
  color: string;
  /** The Labor ring's colour, when it differs from the Bills ring's. */
  laborColor?: string;
}

/**
 * One job's month by cost code, in Tracking Sheets' colours: sales tax out of
 * bills, the biggest codes in the categorical slots, the rest folded into one
 * grey "Other cost codes".
 */
function codeItems(raw: CostDonutRow[]): RingItem[] {
  const rows = withoutSalesTax(raw);
  const colors = buildColorMap(rows);
  const out: RingItem[] = [];
  const other: RingItem = {
    key: "__other",
    label: "Other cost codes",
    bills: 0,
    labor: 0,
    color: "var(--viz-other)",
  };
  for (const r of rows) {
    const bills = Math.max(r.bills, 0);
    const labor = Math.max(r.labor, 0);
    const color = colors.get(r.code);
    if (color)
      out.push({
        key: r.code,
        label: r.name ? `${r.code} · ${r.name}` : r.code,
        bills,
        labor,
        color,
      });
    else {
      other.bills += bills;
      other.labor += labor;
    }
  }
  out.sort((a, b) => b.bills + b.labor - (a.bills + a.labor));
  return other.bills + other.labor > 0 ? [...out, other] : out;
}

/**
 * The month's Bills ring and Labor ring, sized to the space they are given
 * (the header row's height, set by the jobs list), with the Total and then
 * Bills and Labor on one line under them. A slice lifts on hover and names
 * itself with its bills and labor; with `onSelect` a click opens it.
 */
function Rings({ items, onSelect }: { items: RingItem[]; onSelect?: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Each ring is its caption (~24px) over a square; two side by side, 40px apart.
  const size = Math.floor(Math.min(box.h - 24, (box.w - 40) / 2, 280));

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
        color: field === "labor" ? (r.laborColor ?? r.color) : r.color,
      }));
  return (
    <>
      {/* The rings take what is left of the row; absolute, so their size never
          feeds back into the row's height. */}
      <div className="relative min-h-[180px] flex-1">
        <div ref={ref} className="absolute inset-0 flex items-center justify-center gap-10">
          {size >= 80 && (
            <>
              <Donut
                title="Bills"
                slices={slices("bills")}
                emptyLabel="No bills"
                size={size}
                legend={false}
                onSelect={onSelect}
                detail={detail}
              />
              <Donut
                title="Labor"
                slices={slices("labor")}
                emptyLabel="No labor"
                size={size}
                legend={false}
                onSelect={onSelect}
                detail={detail}
              />
            </>
          )}
        </div>
      </div>
      <div className="text-center tabular-nums">
        <div className="flex items-baseline justify-center gap-3">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-[28px] font-bold leading-none tracking-tight">
            {money0(bills + labor)}
          </span>
        </div>
        <div className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          Bills {money0(bills)} · Labor {money0(labor)}
        </div>
      </div>
    </>
  );
}
