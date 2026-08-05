"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PageHeader,
  Select,
  Card,
  Banner,
  Loading,
  EmptyState,
  SectionLabel,
  Toggle,
} from "@/components/ui";
import { JobPicker, type JobRef } from "@/components/JobPicker";
import { Donut, type DonutSlice } from "@/components/Donut";

/**
 * Jobs cost browser — pick a job, see its cost laid out like the office's
 * Tracking Sheet.
 *
 * DATA. Everything comes from two cached server routes rather than the browser
 * driving the Pave gateway itself. `/api/jobs/browser` is one fetch for the job
 * list + each job's "Phase" custom field (it used to be up to 30 client round
 * trips: paging organization.jobs, then paging the custom field's values).
 * `/api/jobs/cost-detail` is one fetch per job, backed by 3 JobTread calls that
 * let JobTread do the summing server-side (it used to be up to 33 client pages
 * of job.costItems + job.timeEntries).
 *
 * NUMBERS. Budget is JobTread's own "Budgeted Cost" — approved, includeInBudget
 * customerOrder lines, i.e. the proposal PLUS approved change orders. Actual is
 * approved+pending vendor bills (BILLS) plus job time entries (LABOR); the two
 * come from different connections and never double-count. ECTC = budget −
 * actual, the same arithmetic getCostToComplete uses on the bill view.
 *
 * LAYOUT. One responsive route. On a phone the table is identity + Budget /
 * Actual / Remaining; at lg+ it widens to the full Tracking-Sheet grid (unit
 * pricing, the cost-type split, actual labor hours) inside its own horizontal
 * scroll container, so the page body never scrolls sideways. Every row expands:
 * CSI division → cost code → the individual estimate lines.
 */

interface BrowserJob extends JobRef {
  phase: string | null;
}

interface CostLine {
  id: string;
  name: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitCost?: number;
  cost: number;
  costType?: string;
  isAllowance: boolean;
}

interface CostTypeSplit {
  labor: number;
  allowance: number;
  sub: number;
  vendor: number;
  other: number;
}

interface CostCodeRow {
  number: string;
  name: string;
  division: string;
  budget: number;
  bills: number;
  labor: number;
  laborHours: number;
  invoiced: number;
  currentInvoice: number;
  split: CostTypeSplit;
  lines: CostLine[];
}

interface CostDivisionRow {
  division: string;
  name: string;
  budget: number;
  bills: number;
  labor: number;
  laborHours: number;
  invoiced: number;
  currentInvoice: number;
  split: CostTypeSplit;
  codes: CostCodeRow[];
}

interface JobCostDetail {
  divisions: CostDivisionRow[];
  budgetBasis: "customerOrders" | "budgetLeaves";
  budgetTotal: number;
  billsTotal: number;
  laborTotal: number;
  laborHoursTotal: number;
  invoicedTotal: number;
  currentInvoiceTotal: number;
  currentInvoiceLabel: string | null;
  degraded: string[];
}

/** Actual (spent + committed) = vendor bills + logged labor. */
const actualOf = (r: { bills: number; labor: number }) => r.bills + r.labor;

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Compact money for the wide grid, where two decimals on 14 columns is noise. */
const money0 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const num = (n: number, dp = 1) =>
  n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** A zero cell reads as "—" so the eye lands only on real numbers. */
const cell = (n: number, fmt: (v: number) => string = money0) => (n ? fmt(n) : "—");
/** Share of budget already invoiced; blank when there's no budget to divide by. */
const pctInvoiced = (invoiced: number, budget: number) =>
  budget > 0 ? `${Math.round((invoiced / budget) * 100)}%` : "—";

/**
 * Which cost-type column a line belongs in — mirrors splitKeyFor() in
 * lib/jobtread.ts so a line's own total lands under the same heading its cost
 * contributed to at the code and division levels (the Tracking Sheet puts each
 * row's total in its LABOR / ALLOWANCE / SUB / VENDOR column the same way).
 */
function lineSplitKey(l: CostLine): keyof CostTypeSplit {
  if (l.isAllowance) return "allowance";
  switch ((l.costType ?? "").trim().toLowerCase()) {
    case "labor":
      return "labor";
    case "subcontractor":
      return "sub";
    case "materials":
      return "vendor";
    default:
      return "other";
  }
}

/** Fixed-order categorical slots (globals.css); a 9th division folds to "Other". */
const VIZ_SLOTS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-7)",
] as const;
const VIZ_OTHER = "var(--viz-other)";

/**
 * Stable division → color map shared by BOTH donuts so a division keeps one
 * color whether it appears in the bills ring, the labor ring, or both. The
 * divisions with the most spend (bills + labor) claim the fixed slots; the rest
 * fold into a single gray "Other" slice. Colors are then assigned in division-
 * number order (not by rank) so the mapping is stable across the two rings.
 */
function buildColorMap(rows: CostDivisionRow[]): Map<string, string> {
  const spent = rows
    .map((r) => ({ division: r.division, v: actualOf(r) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, VIZ_SLOTS.length)
    .map((x) => x.division)
    .sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  spent.forEach((division, i) => map.set(division, VIZ_SLOTS[i]));
  return map;
}

/** Build donut slices for one actual field, folding un-slotted divisions to "Other". */
function buildSlices(
  rows: CostDivisionRow[],
  colorMap: Map<string, string>,
  field: "bills" | "labor",
): DonutSlice[] {
  const out: DonutSlice[] = [];
  let other = 0;
  for (const r of rows) {
    const v = r[field];
    if (v <= 0) continue;
    const color = colorMap.get(r.division);
    const label = r.name ? `${r.division} · ${r.name}` : r.division;
    if (color) out.push({ key: r.division, label, value: v, color });
    else other += v;
  }
  if (other > 0)
    out.push({ key: "__other", label: "Other divisions", value: other, color: VIZ_OTHER });
  return out;
}

/** "Customer - Job", or just the job name when the customer is unknown. */
const jobLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

/** Sentinel for the "jobs with no Phase set" filter option. */
const NO_PHASE = "__no_phase__";

/** The overhead jobs booked to the company itself rather than a customer. */
const isAscentJob = (j: BrowserJob) => /^ascent/i.test((j.customer ?? "").trim());

/**
 * Horizontal "budget used" indicator — total actual spend as a share of the
 * job's budget. Fills accent up to 100%, turns red past budget, and reads out
 * the dollar figures. When there's no budget to compare against it degrades to
 * an actual-spend readout rather than a misleading empty bar.
 */
function ProgressBar({ actual, budget, pct }: { actual: number; budget: number; pct: number }) {
  const over = budget > 0 && actual > budget;
  const fill = Math.min(pct, 1) * 100;
  const rounded = Math.round(pct * 100);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <SectionLabel>Budget used</SectionLabel>
        {budget > 0 ? (
          <span
            className={`text-xs font-semibold tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}
          >
            {rounded}%
          </span>
        ) : (
          <span className="text-xs text-neutral-400">No budget set</span>
        )}
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
        role="progressbar"
        aria-valuenow={budget > 0 ? rounded : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Budget used"
      >
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-accent"}`}
          style={{ width: `${budget > 0 ? fill : 0}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        {money(actual)} spent{budget > 0 ? ` of ${money(budget)} budget` : ""}
        {over ? ` · ${money(actual - budget)} over` : ""}
      </p>
    </div>
  );
}

/** One headline figure. Four of these sit above the chart row on desktop. */
function Kpi({ label, value, tone }: { label: string; value: string; tone?: "over" | "under" }) {
  return (
    <Card className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <p
        className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${
          tone === "over"
            ? "text-red-600 dark:text-red-400"
            : tone === "under"
              ? "text-emerald-600 dark:text-emerald-400"
              : ""
        }`}
      >
        {value}
      </p>
    </Card>
  );
}

/* Column visibility: `wide` cells exist only at lg+, where the grid opens up to
   the full Tracking-Sheet column set. */
const WIDE = "hidden lg:table-cell";
const TH = "whitespace-nowrap py-1.5 pr-3 text-right text-[11px] font-semibold";
const TD = "whitespace-nowrap py-1.5 pr-3 text-right tabular-nums";

export function JobsBrowser() {
  const [jobs, setJobs] = useState<BrowserJob[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [phaseFilter, setPhaseFilter] = useState("");
  const [hideAscent, setHideAscent] = useState(true);
  const [jobId, setJobId] = useState("");

  const [detail, setDetail] = useState<JobCostDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [openDivisions, setOpenDivisions] = useState<Set<string>>(new Set());
  const [openCodes, setOpenCodes] = useState<Set<string>>(new Set());

  // One fetch for the whole list, Phase included (server-side + Data-Cached).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs/browser")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) setJobsError(j.error);
        else setJobs(j.jobs ?? []);
      })
      .catch((e) => {
        if (!cancelled) setJobsError(e instanceof Error ? e.message : "Failed to load jobs");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const phases = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs ?? []) if (j.phase) set.add(j.phase);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [jobs]);
  const hasNoPhase = useMemo(() => !!jobs?.some((j) => !j.phase), [jobs]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    return jobs.filter((j) => {
      if (hideAscent && isAscentJob(j)) return false;
      if (phaseFilter) {
        return phaseFilter === NO_PHASE ? !j.phase : j.phase === phaseFilter;
      }
      return true;
    });
  }, [jobs, phaseFilter, hideAscent]);

  // A job filtered out from under the picker can't stay selected, or the panel
  // would show costs for a job the dropdown no longer lists.
  useEffect(() => {
    if (jobId && !filtered.some((j) => j.id === jobId)) setJobId("");
  }, [filtered, jobId]);

  const selected = useMemo(() => filtered.find((j) => j.id === jobId) ?? null, [filtered, jobId]);

  const loadDetail = useCallback((id: string) => {
    setDetail(null);
    setDetailError(null);
    setOpenDivisions(new Set());
    setOpenCodes(new Set());
    if (!id) return;
    setDetailLoading(true);
    fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setDetailError(j.error);
        else setDetail(j as JobCostDetail);
      })
      .catch((e) => setDetailError(e instanceof Error ? e.message : "Failed to load job costs"))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    loadDetail(jobId);
  }, [jobId, loadDetail]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const rows = detail?.divisions ?? [];
  const budgetTotal = detail?.budgetTotal ?? 0;
  const billsTotal = detail?.billsTotal ?? 0;
  const laborTotal = detail?.laborTotal ?? 0;
  const laborHoursTotal = detail?.laborHoursTotal ?? 0;
  const invoicedTotal = detail?.invoicedTotal ?? 0;
  const currentInvoiceTotal = detail?.currentInvoiceTotal ?? 0;
  const actualTotal = billsTotal + laborTotal;
  const usedPct = budgetTotal > 0 ? actualTotal / budgetTotal : 0;

  const colorMap = useMemo(
    () => (rows.length ? buildColorMap(rows) : new Map<string, string>()),
    [rows],
  );
  const billsSlices = useMemo(() => buildSlices(rows, colorMap, "bills"), [rows, colorMap]);
  const laborSlices = useMemo(() => buildSlices(rows, colorMap, "labor"), [rows, colorMap]);

  const totalSplit = useMemo(
    () =>
      rows.reduce(
        (acc, d) => ({
          labor: acc.labor + d.split.labor,
          allowance: acc.allowance + d.split.allowance,
          sub: acc.sub + d.split.sub,
          vendor: acc.vendor + d.split.vendor,
          other: acc.other + d.split.other,
        }),
        { labor: 0, allowance: 0, sub: 0, vendor: 0, other: 0 },
      ),
    [rows],
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 lg:max-w-[110rem]">
      <PageHeader
        title="Jobs"
        description="Pick a job for its cost by CSI division, cost code, and estimate line."
      />

      {jobsError && (
        <Banner tone="error" className="mb-4">
          {jobsError}
        </Banner>
      )}

      {!jobs && !jobsError && <Loading label="Loading jobs…" />}

      {jobs && (
        <>
          <Card className="mb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-stretch">
                <JobPicker
                  value={jobId}
                  onChange={setJobId}
                  jobs={filtered}
                  includeAll={false}
                  placeholder="Select a job…"
                />
              </div>
              <Select
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
                className="lg:w-56"
                aria-label="Filter by phase"
              >
                <option value="">All phases</option>
                {phases.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {hasNoPhase && <option value={NO_PHASE}>(No phase)</option>}
              </Select>
              <Toggle
                checked={hideAscent}
                onChange={setHideAscent}
                label="Hide Ascent jobs"
                className="shrink-0"
              />
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">
              {filtered.length} of {jobs.length} job{jobs.length === 1 ? "" : "s"} · live from
              JobTread
            </p>
          </Card>

          {!selected && !detailLoading && (
            <EmptyState>
              {filtered.length === 0
                ? "No jobs match these filters."
                : "Choose a job above to see its costs."}
            </EmptyState>
          )}

          {detailLoading && <Loading label="Loading job costs…" />}
          {detailError && <Banner tone="error">{detailError}</Banner>}

          {selected && detail && !detailLoading && !detailError && (
            <>
              {detail.degraded.length > 0 && (
                <Banner tone="warning" className="mb-4">
                  Fell back to the slow query path for: {detail.degraded.join(", ")}. Numbers are
                  correct, just slower than usual.
                </Banner>
              )}

              {detail.budgetBasis === "budgetLeaves" && (
                <Banner tone="info" className="mb-4">
                  This job has no approved customer orders, so Budget is the base estimate rather
                  than JobTread&apos;s Budgeted Cost. It won&apos;t include change orders.
                </Banner>
              )}

              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Kpi
                  label={detail.budgetBasis === "budgetLeaves" ? "Base estimate" : "Budgeted cost"}
                  value={money0(budgetTotal)}
                />
                <Kpi label="Actual" value={money0(actualTotal)} />
                <Kpi
                  label="Cost to complete"
                  value={money0(budgetTotal - actualTotal)}
                  tone={budgetTotal - actualTotal < 0 ? "over" : "under"}
                />
                <Kpi
                  label={`Invoiced · ${pctInvoiced(invoicedTotal, budgetTotal)}`}
                  value={money0(invoicedTotal)}
                />
                <Kpi label="Labor hours" value={num(laborHoursTotal, 1)} />
              </div>

              <Card className="mb-4">
                <ProgressBar actual={actualTotal} budget={budgetTotal} pct={usedPct} />
              </Card>

              {rows.length === 0 ? (
                <EmptyState>No approved budget or cost on this job yet.</EmptyState>
              ) : (
                <>
                  <SectionLabel className="mb-2">Cost by CSI division</SectionLabel>
                  <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Donut
                      title={`Bills · ${money(billsTotal)}`}
                      slices={billsSlices}
                      centerLabel="bills"
                      emptyLabel="No vendor bills yet"
                    />
                    <Donut
                      title={`Labor · ${money(laborTotal)}`}
                      slices={laborSlices}
                      centerLabel="labor"
                      emptyLabel="No labor logged yet"
                    />
                  </div>

                  <SectionLabel className="mb-2">Cost detail</SectionLabel>
                  <Card pad={false} className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-200 text-neutral-400 dark:border-neutral-700/60">
                            <th className="py-1.5 pl-3 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                              Code / Item
                            </th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Qty</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Unit</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Price</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Labor</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Allow.</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Sub</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Vendor</th>
                            <th className={`${TH} uppercase tracking-wide`}>Budget</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Act. hrs</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Act. labor</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Bills</th>
                            <th className={`${TH} uppercase tracking-wide`}>Actual</th>
                            <th className={`${TH} uppercase tracking-wide`}>To complete</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Prev. inv.</th>
                            <th
                              className={`${TH} ${WIDE} uppercase tracking-wide`}
                              title={detail.currentInvoiceLabel ?? undefined}
                            >
                              Current inv.
                            </th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>Invoiced</th>
                            <th className={`${TH} ${WIDE} uppercase tracking-wide`}>% inv.</th>
                          </tr>
                        </thead>

                        <tbody>
                          {rows.map((d) => {
                            const dOpen = openDivisions.has(d.division);
                            const dActual = actualOf(d);
                            const dLeft = d.budget - dActual;
                            const swatch = colorMap.get(d.division);
                            return (
                              <FragmentRows key={d.division}>
                                {/* ---- level 1: CSI division ---- */}
                                <tr className="border-b border-neutral-100 bg-neutral-50/60 dark:border-neutral-800 dark:bg-white/[0.03]">
                                  <td className="py-1.5 pl-1 pr-3">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenDivisions((s) => toggle(s, d.division))
                                      }
                                      aria-expanded={dOpen}
                                      className="flex w-full items-center gap-1.5 text-left transition hover:text-accent"
                                    >
                                      <span
                                        aria-hidden
                                        className={`shrink-0 text-xs text-neutral-400 transition-transform ${dOpen ? "rotate-90" : ""}`}
                                      >
                                        ▸
                                      </span>
                                      <span
                                        aria-hidden
                                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                                        style={{
                                          backgroundColor: swatch ?? "transparent",
                                          outline: swatch
                                            ? undefined
                                            : "1px solid rgb(var(--accent) / 0.25)",
                                        }}
                                      />
                                      <span className="font-mono text-xs text-neutral-500">
                                        {d.division}
                                      </span>
                                      <span className="truncate font-semibold">{d.name}</span>
                                    </button>
                                  </td>
                                  <td className={`${TD} ${WIDE}`} />
                                  <td className={`${TD} ${WIDE}`} />
                                  <td className={`${TD} ${WIDE}`} />
                                  <td className={`${TD} ${WIDE}`}>{cell(d.split.labor)}</td>
                                  <td className={`${TD} ${WIDE}`}>{cell(d.split.allowance)}</td>
                                  <td className={`${TD} ${WIDE}`}>{cell(d.split.sub)}</td>
                                  <td className={`${TD} ${WIDE}`}>{cell(d.split.vendor)}</td>
                                  <td className={`${TD} font-semibold`}>{cell(d.budget)}</td>
                                  <td className={`${TD} ${WIDE} text-neutral-500`}>
                                    {d.laborHours ? num(d.laborHours) : "—"}
                                  </td>
                                  <td className={`${TD} ${WIDE} text-neutral-500`}>
                                    {cell(d.labor)}
                                  </td>
                                  <td className={`${TD} ${WIDE} text-neutral-500`}>
                                    {cell(d.bills)}
                                  </td>
                                  <td className={`${TD} font-semibold`}>{cell(dActual)}</td>
                                  <td
                                    className={`${TD} font-semibold ${dLeft < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                                  >
                                    {cell(dLeft)}
                                  </td>
                                  <td className={`${TD} ${WIDE} text-neutral-500`}>
                                    {cell(d.invoiced - d.currentInvoice)}
                                  </td>
                                  <td className={`${TD} ${WIDE} text-neutral-500`}>
                                    {cell(d.currentInvoice)}
                                  </td>
                                  <td className={`${TD} ${WIDE} font-semibold`}>
                                    {cell(d.invoiced)}
                                  </td>
                                  <td className={`${TD} ${WIDE} text-neutral-500`}>
                                    {pctInvoiced(d.invoiced, d.budget)}
                                  </td>
                                </tr>

                                {/* ---- level 2: cost code ---- */}
                                {dOpen &&
                                  d.codes.map((c) => {
                                    const key = `${d.division}/${c.number}`;
                                    const cOpen = openCodes.has(key);
                                    const cActual = actualOf(c);
                                    const cLeft = c.budget - cActual;
                                    return (
                                      <FragmentRows key={key}>
                                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                                          <td className="py-1.5 pl-1 pr-3">
                                            <button
                                              type="button"
                                              onClick={() => setOpenCodes((s) => toggle(s, key))}
                                              aria-expanded={cOpen}
                                              disabled={c.lines.length === 0}
                                              className="flex w-full items-center gap-1.5 pl-5 text-left transition hover:text-accent disabled:cursor-default disabled:hover:text-inherit"
                                            >
                                              <span
                                                aria-hidden
                                                className={`shrink-0 text-xs text-neutral-400 transition-transform ${cOpen ? "rotate-90" : ""} ${c.lines.length === 0 ? "opacity-0" : ""}`}
                                              >
                                                ▸
                                              </span>
                                              <span className="whitespace-nowrap font-mono text-xs text-neutral-500">
                                                {c.number}
                                              </span>
                                              <span className="truncate">{c.name}</span>
                                            </button>
                                          </td>
                                          <td className={`${TD} ${WIDE}`} />
                                          <td className={`${TD} ${WIDE}`} />
                                          <td className={`${TD} ${WIDE}`} />
                                          <td className={`${TD} ${WIDE}`}>{cell(c.split.labor)}</td>
                                          <td className={`${TD} ${WIDE}`}>
                                            {cell(c.split.allowance)}
                                          </td>
                                          <td className={`${TD} ${WIDE}`}>{cell(c.split.sub)}</td>
                                          <td className={`${TD} ${WIDE}`}>
                                            {cell(c.split.vendor)}
                                          </td>
                                          <td className={TD}>{cell(c.budget)}</td>
                                          <td className={`${TD} ${WIDE} text-neutral-500`}>
                                            {c.laborHours ? num(c.laborHours) : "—"}
                                          </td>
                                          <td className={`${TD} ${WIDE} text-neutral-500`}>
                                            {cell(c.labor)}
                                          </td>
                                          <td className={`${TD} ${WIDE} text-neutral-500`}>
                                            {cell(c.bills)}
                                          </td>
                                          <td className={TD}>{cell(cActual)}</td>
                                          <td
                                            className={`${TD} ${cLeft < 0 ? "font-semibold text-red-600 dark:text-red-400" : ""}`}
                                          >
                                            {cell(cLeft)}
                                          </td>
                                          <td className={`${TD} ${WIDE} text-neutral-500`}>
                                            {cell(c.invoiced - c.currentInvoice)}
                                          </td>
                                          <td className={`${TD} ${WIDE} text-neutral-500`}>
                                            {cell(c.currentInvoice)}
                                          </td>
                                          <td className={`${TD} ${WIDE}`}>{cell(c.invoiced)}</td>
                                          <td className={`${TD} ${WIDE} text-neutral-500`}>
                                            {pctInvoiced(c.invoiced, c.budget)}
                                          </td>
                                        </tr>

                                        {/* ---- level 3: estimate line ---- */}
                                        {cOpen &&
                                          c.lines.map((l) => (
                                            <tr
                                              key={l.id}
                                              className="border-b border-neutral-100 text-xs text-neutral-500 dark:border-neutral-800"
                                            >
                                              <td className="py-1 pl-3 pr-3">
                                                <span className="flex min-w-0 flex-col pl-11">
                                                  <span className="truncate">
                                                    {l.name || "(unnamed line)"}
                                                    {l.isAllowance && (
                                                      <span className="ml-1.5 rounded bg-neutral-200 px-1 py-px text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                                                        allowance
                                                      </span>
                                                    )}
                                                  </span>
                                                  {l.description && (
                                                    <span className="truncate text-[11px] text-neutral-400">
                                                      {l.description}
                                                    </span>
                                                  )}
                                                </span>
                                              </td>
                                              <td className={`${TD} ${WIDE}`}>
                                                {l.quantity != null ? num(l.quantity, 2) : "—"}
                                              </td>
                                              <td
                                                className={`${TD} ${WIDE} text-left text-neutral-400`}
                                              >
                                                {l.unit ?? "—"}
                                              </td>
                                              <td className={`${TD} ${WIDE}`}>
                                                {l.unitCost != null ? money(l.unitCost) : "—"}
                                              </td>
                                              {(
                                                ["labor", "allowance", "sub", "vendor"] as const
                                              ).map((k) => (
                                                <td key={k} className={`${TD} ${WIDE}`}>
                                                  {lineSplitKey(l) === k ? cell(l.cost) : "—"}
                                                </td>
                                              ))}
                                              <td className={TD}>{cell(l.cost)}</td>
                                              <td className={`${TD} ${WIDE}`} colSpan={3} />
                                              <td className={TD} />
                                              <td className={TD} />
                                              <td className={`${TD} ${WIDE}`} colSpan={4} />
                                            </tr>
                                          ))}
                                      </FragmentRows>
                                    );
                                  })}
                              </FragmentRows>
                            );
                          })}
                        </tbody>

                        <tfoot>
                          <tr className="border-t-2 border-neutral-300 font-semibold dark:border-neutral-600">
                            <td className="py-2 pl-3 pr-3 text-left">Total</td>
                            <td className={`${TD} ${WIDE}`} />
                            <td className={`${TD} ${WIDE}`} />
                            <td className={`${TD} ${WIDE}`} />
                            <td className={`${TD} ${WIDE}`}>{cell(totalSplit.labor)}</td>
                            <td className={`${TD} ${WIDE}`}>{cell(totalSplit.allowance)}</td>
                            <td className={`${TD} ${WIDE}`}>{cell(totalSplit.sub)}</td>
                            <td className={`${TD} ${WIDE}`}>{cell(totalSplit.vendor)}</td>
                            <td className={TD}>{cell(budgetTotal)}</td>
                            <td className={`${TD} ${WIDE} text-neutral-500`}>
                              {laborHoursTotal ? num(laborHoursTotal) : "—"}
                            </td>
                            <td className={`${TD} ${WIDE} text-neutral-500`}>{cell(laborTotal)}</td>
                            <td className={`${TD} ${WIDE} text-neutral-500`}>{cell(billsTotal)}</td>
                            <td className={TD}>{cell(actualTotal)}</td>
                            <td
                              className={`${TD} ${budgetTotal - actualTotal < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                            >
                              {cell(budgetTotal - actualTotal)}
                            </td>
                            <td className={`${TD} ${WIDE} text-neutral-500`}>
                              {cell(invoicedTotal - currentInvoiceTotal)}
                            </td>
                            <td className={`${TD} ${WIDE} text-neutral-500`}>
                              {cell(currentInvoiceTotal)}
                            </td>
                            <td className={`${TD} ${WIDE}`}>{cell(invoicedTotal)}</td>
                            <td className={`${TD} ${WIDE} text-neutral-500`}>
                              {pctInvoiced(invoicedTotal, budgetTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </Card>

                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                    {detail.budgetBasis === "budgetLeaves"
                      ? "Budget is this job's base estimate (it has no approved customer orders, so there is no Budgeted Cost to read)."
                      : "Budget is JobTread's Budgeted Cost — approved customer orders, so it includes approved change orders."}{" "}
                    Actual = approved and pending vendor bills
                    (Bills) plus logged time entries (Act. labor); the two never double-count. To
                    complete = budget − actual; negative is over budget and shown in red. Labor,
                    Allow., Sub and Vendor split the <em>estimate</em> by cost type. Invoiced is
                    approved customer invoices;{" "}
                    {detail.currentInvoiceLabel
                      ? `“Current inv.” is the most recent one (${detail.currentInvoiceLabel}), and “Prev. inv.” is everything before it.`
                      : "there are no approved customer invoices on this job yet."}{" "}
                    Rotate to landscape or open on a desktop for the full column set.
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

/**
 * Groups sibling <tr>s without wrapping them in an element — a <div> between
 * <tbody> and <tr> is invalid HTML and breaks the shared column widths.
 */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
