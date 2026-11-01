"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Donut } from "@/components/Donut";

import { useAccess } from "@/components/AccessProvider";
import { JobOverview } from "@/components/HomeJobBoard";
import { JobPicker, WORKING_PHASES } from "@/components/JobPicker";
import { LopezMap } from "@/components/LopezMap";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  MetaLine,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
} from "@/components/ui";
import { buildColorMap, withoutSalesTax, type CostDonutRow } from "@/app/trackingsheet/CostDonuts";
import { Board } from "@/app/trackingsheet/Board";
import { monthJobRows, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import type { MonthCodeRow } from "@/lib/monthCostByJob";
import { billingMonths } from "@/lib/billingMonths";
import type { MapJob } from "@/lib/lopezMap";
import { scheduleHeadline, shortDate, type JobsPageCard } from "@/lib/jobBoard";
import { jtJobUrl } from "@/lib/jtLinks";
import { money0 } from "@/lib/money";

/**
 * Jobs Hub — the desktop screen for every job at once (owner, 2026-11-01; the
 * Figma draft is "Ascent — Jobs Hub (desktop draft)").
 *
 *   • The title is Tracking Sheets' job picker ("All Jobs" until a job is
 *     picked), with its phase filter and amounts to invoice.
 *   • Under it, the header: ONE card of one height. Across its top the
 *     picked job's name, links and Bills / Schedule switch; under that, side
 *     by side, the rings (Total / Bills / Labor, a legend, a Bills ring and a
 *     Labor ring — every job in the picked month, or the picked job by cost
 *     code with a Month / All time switch), a small Lopez Island map (no
 *     legend, one size in both views) and the job's details (the Job Board's
 *     card, /api/job-board) with an Edit link to JobTread.
 *   • Under the header, the main window. Bills (the default): the job's
 *     Tracking Sheet, embedded — its bills and labor column and its coding
 *     drawer side by side; the sheet's own rings stay out. Schedule: the job's
 *     overview (cost by division, schedule).
 *
 * The picker, a ring slice or a dot picks the job.
 *
 * Every write is the embedded Tracking Sheet's own; nothing here writes.
 */

type HubJob = MapJob & { customer?: string | null };
const jobLabel = (j: HubJob) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

interface ToInvoice {
  ym: string;
  totals: Record<string, number>;
}

export function JobsHub() {
  const canTrackingSheet = useAccess().can("recode");
  const [jobs, setJobs] = useState<HubJob[] | null>(null);
  const [toInvoice, setToInvoice] = useState<ToInvoice | null>(null);
  /** The Job Board's cards, by job id — address, number and schedule span. */
  const [details, setDetails] = useState<Map<string, JobsPageCard> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Schedule (the job's overview and details) or Bills — the job's Tracking
   * Sheet, embedded: its bills and labor column takes the overview's place and
   * its coding drawer takes the details card's, under the map. The board draws into these
   * two nodes (Board's `embed`), so every save, approve and recode is the
   * Tracking Sheet's own, unchanged.
   */
  const [view, setView] = useState<"schedule" | "bills">("bills");
  const [codingSlot, setCodingSlot] = useState<HTMLElement | null>(null);
  const [billsSlot, setBillsSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => !cancelled && setJobs([]));
    // One fetch for the whole list: the route scans the month's every bill and
    // time entry. It also names the billing month. A failure leaves both off.
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
    fetch("/api/jobs/to-be-invoiced")
      .then((r) => r.json())
      .then(
        (d) => !cancelled && !d?.error && setToInvoice({ ym: d.ym ?? "", totals: d.totals ?? {} }),
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The rings' month: the billing month until someone picks another.
  const [pickedYm, setPickedYm] = useState<string | null>(null);
  const ym = pickedYm ?? toInvoice?.ym ?? "";
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

  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  const pick = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  // Switching Schedule ↔ Bills swaps a tall column for one still loading, so
  // the page would shrink and the browser pull the view up. Hold the page at
  // its height through the switch and put the scroll back; a new job lets go.
  const mainRef = useRef<HTMLElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  const switchView = (v: "schedule" | "bills") => {
    const y = window.scrollY;
    setHeldHeight(mainRef.current?.offsetHeight);
    setView(v);
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  };
  useEffect(() => setHeldHeight(undefined), [selectedId]);

  return (
    <main
      ref={mainRef}
      className="w-full px-4 pb-10 pt-5 pad:px-7"
      style={{ minHeight: heldHeight }}
    >
      {/* The title IS the job picker, as on Tracking Sheets: "All Jobs" until a
          job is picked. */}
      <PageHeader
        titleSlot={
          <JobPicker
            variant="title"
            value={selectedId ?? ""}
            onChange={(id) => setSelectedId(id || null)}
            placeholder="All Jobs"
            allLabel="All Jobs"
            allDescription="Every job's month, side by side"
            showPhaseFilter
            defaultPhases={WORKING_PHASES}
            showToBeInvoiced={canTrackingSheet}
          />
        }
      />

      <div className="min-w-0 space-y-6">
        {/* ONE card, one height (owner, 2026-11-01): the picked job's name,
            links and Bills / Schedule switch across the top; under it the
            rings, the map and the job's details side by side. */}
        <Card pad={false} className="overflow-hidden">
          {selected && (
            <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-base font-semibold tracking-tight">{jobLabel(selected)}</div>
                <MetaLine
                  items={[
                    selected.phase,
                    (toInvoice?.totals[selected.id] ?? 0) > 0 &&
                      `${money0(toInvoice!.totals[selected.id])} to invoice`,
                    canTrackingSheet && (
                      <Link
                        key="sheet"
                        href={`/trackingsheet?jobId=${encodeURIComponent(selected.id)}`}
                        className="font-semibold text-accent hover:underline dark:text-accent-soft"
                      >
                        Tracking sheet →
                      </Link>
                    ),
                    <Link
                      key="job"
                      href={`/job-board/${encodeURIComponent(selected.id)}`}
                      className="font-semibold text-accent hover:underline dark:text-accent-soft"
                    >
                      Job page →
                    </Link>,
                  ]}
                />
              </div>
              {canTrackingSheet && (
                <Segmented
                  label="Show"
                  value={view}
                  onChange={switchView}
                  options={[
                    { value: "bills", label: "Bills" },
                    { value: "schedule", label: "Schedule" },
                  ]}
                />
              )}
              <Button variant="secondary" size="xs" onClick={() => setSelectedId(null)}>
                Close
              </Button>
            </div>
          )}
          <div className="flex flex-col divide-y divide-line-soft xl:flex-row xl:divide-x xl:divide-y-0">
            <div className="min-h-0 min-w-0 flex-1 p-4">
              {selected ? (
                <JobRings
                  key={selected.id}
                  job={selected}
                  monthSelect={monthSelect}
                  monthRows={monthJobs?.find((j) => j.jobId === selected.id)?.rows ?? []}
                />
              ) : monthJobs ? (
                <RingsCard
                  caption="All jobs"
                  items={monthJobRows(monthJobs)}
                  control={monthSelect}
                  onSelect={pick}
                />
              ) : (
                <Skeleton className="h-full min-h-40 w-full rounded-xl" />
              )}
            </div>
            {/* The map (one size in both views) with the job's details directly
                under it. This column sets the card's height; the rings stretch to it. */}
            <div className="space-y-3 p-4 xl:w-[300px] xl:shrink-0">
              <div className="mx-auto w-[170px]">
                {jobs ? (
                  <LopezMap jobs={jobs} selectedId={selectedId} onSelect={pick} legend={false} />
                ) : (
                  <Loading />
                )}
              </div>
              {selected && (
                <JobDetails job={selected} card={details?.get(selected.id)} loading={!details} />
              )}
            </div>
          </div>
        </Card>

        {/* THE MAIN WINDOW */}
        {selected ? (
          view === "bills" && canTrackingSheet ? (
            <>
              {/* The board draws its bills and labor column into the left
                  slot and its coding drawer into the right. */}
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div ref={setBillsSlot} className="min-w-0" />
                <div ref={setCodingSlot} className="min-w-0" />
              </div>
              {/* Keyed by job and month: a new pick is a fresh board. Staged
                  coding survives it — the board restores unsynced work on
                  load and says so. */}
              {ym && (
                <Suspense fallback={null}>
                  <Board
                    key={`${selected.id}-${ym}`}
                    embed={{ jobId: selected.id, ym, billsSlot, codingSlot }}
                  />
                </Suspense>
              )}
            </>
          ) : (
            /* Keyed so a new job starts its own fetch rather than showing the last one's. */
            <JobOverview key={selected.id} jobId={selected.id} />
          )
        ) : (
          <EmptyState>Pick a job from the list, a ring or the map.</EmptyState>
        )}
      </div>
    </main>
  );
}

interface RingItem {
  key: string;
  label: string;
  bills: number;
  labor: number;
  color: string;
}

/**
 * The header card's rings section, filling the card's one height: Total, Bills
 * and Labor; a legend that scrolls inside it; the Bills and Labor rings.
 */
function RingsCard({
  caption,
  items,
  control,
  onSelect,
}: {
  caption: string;
  items: RingItem[];
  control?: React.ReactNode;
  onSelect?: (key: string) => void;
}) {
  const bills = items.reduce((n, r) => n + r.bills, 0);
  const labor = items.reduce((n, r) => n + r.labor, 0);
  const shown = items.filter((r) => r.bills > 0 || r.labor > 0);
  const slices = (field: "bills" | "labor") =>
    shown
      .filter((r) => r[field] > 0)
      .map((r) => ({ key: r.key, label: r.label, value: r[field], color: r.color }));
  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row lg:gap-8">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {caption}
          </div>
          {control}
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-0.5 tabular-nums">
          <dt className="text-sm font-semibold">Total</dt>
          <dd className="text-2xl font-bold tracking-tight">{money0(bills + labor)}</dd>
          <dt className="text-[12px] text-neutral-500 dark:text-neutral-400">Bills</dt>
          <dd className="text-[13px]">{money0(bills)}</dd>
          <dt className="text-[12px] text-neutral-500 dark:text-neutral-400">Labor</dt>
          <dd className="text-[13px]">{money0(labor)}</dd>
        </dl>
        <div className="relative min-h-16 flex-1">
          <ul className="absolute inset-0 space-y-1 overflow-y-auto pr-1">
            {shown.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  disabled={!onSelect}
                  onClick={() => onSelect?.(r.key)}
                  className="flex w-full items-center gap-2 text-left text-[13px] enabled:hover:underline"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: r.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                    {money0(r.bills + r.labor)}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="text-[13px] text-neutral-500">No bills or labor.</li>
            )}
          </ul>
        </div>
      </div>
      <div className="flex shrink-0 justify-center gap-6">
        <Donut
          title="Bills"
          slices={slices("bills")}
          emptyLabel="No bills"
          size={100}
          legend={false}
          onSelect={onSelect}
        />
        <Donut
          title="Labor"
          slices={slices("labor")}
          emptyLabel="No labor"
          size={100}
          legend={false}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/**
 * One job's cost codes as ring items, in Tracking Sheets' colours: sales tax
 * out of bills, the biggest codes in the categorical slots, the rest folded
 * into one grey "Other cost codes".
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
 * One job's rings by cost code, this billing month or all time. The month
 * comes from the all-jobs read already in hand; all time is the cost tree's
 * codes (/api/jobs/cost-detail, cached server-side — the overview below makes
 * the same read).
 */
function JobRings({
  job,
  monthRows,
  monthSelect,
}: {
  job: HubJob;
  monthRows: MonthCodeRow[];
  /** The page's month picker, shown while the month scope is on. */
  monthSelect: React.ReactNode;
}) {
  const [scope, setScope] = useState<"month" | "all">("month");
  const [toDate, setToDate] = useState<CostDonutRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(job.id)}`)
      .then((r) => r.json())
      .then(
        (d: {
          divisions?: { codes: { number: string; name: string; bills: number; labor: number }[] }[];
        }) => {
          if (cancelled) return;
          setToDate(
            (d.divisions ?? []).flatMap((dv) =>
              dv.codes.map((c) => ({
                code: c.number,
                name: c.name,
                bills: c.bills,
                labor: c.labor,
              })),
            ),
          );
        },
      )
      .catch(() => !cancelled && setToDate([]));
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  // All time is committed bills (approved + pending, the cost tree's basis)
  // plus the shown month's drafts — the Tracking Sheet's job-to-date ring adds
  // its month's drafts the same way. Without them a job whose only bills are
  // drafts read $0 all time and more than that in its month (Gormley - Studio).
  const rows = scope === "month" ? monthRows : toDate && withDrafts(toDate, monthRows);
  if (!rows) return <Skeleton className="h-full min-h-40 w-full rounded-xl" />;
  return (
    <RingsCard
      caption=""
      items={codeItems(rows)}
      control={
        <>
          {scope === "month" && monthSelect}
          <Segmented
            label="Period"
            value={scope}
            onChange={setScope}
            options={[
              { value: "month", label: "Month" },
              { value: "all", label: "All time" },
            ]}
          />
        </>
      }
    />
  );
}

/** The job-to-date rows with the month's draft-bill cost added, code by code. */
function withDrafts(toDate: CostDonutRow[], month: MonthCodeRow[]): CostDonutRow[] {
  const byCode = new Map(toDate.map((r) => [r.code, { ...r }]));
  for (const m of month) {
    if (!m.drafts) continue;
    const r = byCode.get(m.code);
    if (r) r.bills += m.drafts;
    else byCode.set(m.code, { code: m.code, name: m.name, bills: m.drafts, labor: 0 });
  }
  return [...byCode.values()];
}

/**
 * The picked job's facts, inside the map card under the map. Started and Expected completion are
 * the ends of the job's JobTread schedule (its Gantt span); a job with nothing
 * dated says so rather than inventing a date.
 */
function JobDetails({
  job,
  card,
  loading,
}: {
  job: HubJob;
  card?: JobsPageCard;
  loading: boolean;
}) {
  const s = card?.schedule ?? null;
  const rows: [string, React.ReactNode][] = [
    ["Address", card?.address || "—"],
    ["Job #", card?.number || "—"],
    ["Phase", job.phase || "—"],
    ["Started", s ? shortDate(s.start, 0) : "Not scheduled"],
    ["Expected completion", s ? shortDate(s.end, 0) : "Not scheduled"],
    ["Now", scheduleHeadline(s)],
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <div className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Details
        </div>
        {/* JobTread is where a job's address, number and dates are edited. */}
        <a
          href={jtJobUrl(job.id)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[12px] font-semibold text-accent hover:underline dark:text-accent-soft"
        >
          Edit ↗
        </a>
      </div>
      {loading ? (
        <Loading />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-500 dark:text-neutral-400">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
