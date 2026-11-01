"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Donut } from "@/components/Donut";

import { useAccess } from "@/components/AccessProvider";
import { JobOverview } from "@/components/HomeJobBoard";
import { LopezMap } from "@/components/LopezMap";
import {
  Button,
  Card,
  EmptyState,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Segmented,
  Select,
  Skeleton,
  StatementBlock,
} from "@/components/ui";
import { buildColorMap, withoutSalesTax, type CostDonutRow } from "@/app/trackingsheet/CostDonuts";
import { monthJobRows, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import type { MonthCodeRow } from "@/lib/monthCostByJob";
import { billingMonths, monthLabel } from "@/lib/billingMonths";
import { PHASE_COLORS, type MapJob } from "@/lib/lopezMap";
import { money0 } from "@/lib/money";

/**
 * Jobs Hub — the desktop screen for every job at once (owner, 2026-11-01; the
 * Figma draft is "Ascent — Jobs Hub (desktop draft)").
 *
 *   • Top row, one fixed height: "To be invoiced" (the billing month) over the
 *     list column, and the rings card across the rest (the Figma draft's
 *     summary row). The card reads Total / Bills / Labor, a legend, then a
 *     Bills ring and a Labor ring. No job picked — every job in the picked
 *     month, a slice per job. A job picked — that job by cost code (Tracking
 *     Sheets' colour rules), with a Month / All time switch. The month picker
 *     shows whenever the card is on a month; it starts on the billing month.
 *   • Left: ONE continuous list of the working jobs (Active, then PreCon), a
 *     line each — "Customer - Job", phase, the billing month's amount to
 *     invoice. From `lg` it scrolls inside itself, ending at the window's foot.
 *   • Right: the picked job's overview (cost by division, schedule) beside the
 *     Lopez Island map. A row, a ring slice or a dot picks the job.
 *
 * Read-only. Every write stays on the page it lives on.
 */

/** The working phases, in list order — the ones the map colours. */
const WORKING = [...new Set(PHASE_COLORS.map((p) => p.phase))];

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => !cancelled && setJobs([]));
    // One fetch for the whole list: the route scans the month's every bill and
    // time entry. It also names the billing month. A failure leaves both off.
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
  const colors = useMemo(
    () => new Map(monthJobRows(monthJobs ?? []).map((r) => [r.key, r.color])),
    [monthJobs],
  );

  const working = (jobs ?? [])
    .filter((j) => WORKING.includes(j.phase ?? ""))
    .sort(
      (a, b) =>
        WORKING.indexOf(a.phase ?? "") - WORKING.indexOf(b.phase ?? "") ||
        jobLabel(a).localeCompare(jobLabel(b)),
    );
  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  const pick = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  // From `lg` the job list scrolls inside itself, sized to end at the bottom of
  // the window when the page is at its top — every job is reachable without
  // scrolling the page. Measured, because what sits above it (header, top row)
  // has no fixed height.
  const listRef = useRef<HTMLDivElement>(null);
  const [listMax, setListMax] = useState<number | undefined>(undefined);
  useEffect(() => {
    const fit = () => {
      const el = listRef.current;
      if (!el || !window.matchMedia("(min-width: 1024px)").matches) return setListMax(undefined);
      const top = el.getBoundingClientRect().top + window.scrollY;
      setListMax(Math.max(240, window.innerHeight - top - 24));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [jobs, monthJobs, selectedId]);

  return (
    <main className="w-full px-4 pb-10 pt-5 pad:px-7">
      <PageHeader
        title="Jobs Hub"
        description="Every working job on one screen — this month's money, the island map, and one job in detail."
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="lg:h-52">
          <StatementBlock
            rule={false}
            label={`To be invoiced${toInvoice?.ym ? ` · ${monthLabel(toInvoice.ym)}` : ""}`}
            value={
              toInvoice
                ? money0(
                    selected
                      ? (toInvoice.totals[selected.id] ?? 0)
                      : Object.values(toInvoice?.totals ?? {}).reduce((n, v) => n + v, 0),
                  )
                : "—"
            }
            sub={selected ? jobLabel(selected) : "Bills and time not yet on a client invoice"}
          />
        </Card>
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
          <Skeleton className="h-52 w-full rounded-xl" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-2">
          <SectionHeading
            trailing={
              <span className="text-[11px] tabular-nums text-neutral-500">{working.length}</span>
            }
          >
            Jobs
          </SectionHeading>
          {!jobs ? (
            <Loading />
          ) : working.length === 0 ? (
            <EmptyState>No job has Phase set to Active or PreCon.</EmptyState>
          ) : (
            <div
              ref={listRef}
              className="overflow-y-auto rounded-xl"
              style={{ maxHeight: listMax }}
            >
              <ListCard>
                {working.map((j) => {
                  const owed = toInvoice?.totals[j.id] ?? 0;
                  const swatch = colors.get(j.id);
                  return (
                    <ListRow
                      key={j.id}
                      label={
                        <span className="inline-flex items-center gap-2">
                          {/* The ring's colour for this job; no swatch = no cost this month. */}
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: swatch ?? "transparent" }}
                          />
                          {jobLabel(j)}
                        </span>
                      }
                      desc={j.phase}
                      trailing={
                        owed > 0 ? (
                          <span className="text-[12px] tabular-nums">{money0(owed)}</span>
                        ) : undefined
                      }
                      selected={j.id === selectedId}
                      chevron={false}
                      onClick={() => pick(j.id)}
                    />
                  );
                })}
              </ListCard>
            </div>
          )}
        </aside>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-3">
            {selected ? (
              <>
                <Card className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-base font-semibold tracking-tight">
                      {jobLabel(selected)}
                    </div>
                    <MetaLine
                      items={[
                        selected.phase,
                        (toInvoice?.totals[selected.id] ?? 0) > 0 &&
                          `${money0(toInvoice!.totals[selected.id])} to invoice`,
                        canTrackingSheet && (
                          <Link
                            href={`/trackingsheet?jobId=${encodeURIComponent(selected.id)}`}
                            className="font-semibold text-accent hover:underline dark:text-accent-soft"
                          >
                            Tracking sheet →
                          </Link>
                        ),
                        <Link
                          href={`/job-board/${encodeURIComponent(selected.id)}`}
                          className="font-semibold text-accent hover:underline dark:text-accent-soft"
                        >
                          Job page →
                        </Link>,
                      ]}
                    />
                  </div>
                  <Button variant="secondary" size="xs" onClick={() => setSelectedId(null)}>
                    Close
                  </Button>
                </Card>
                {/* Keyed so a new job starts its own fetch rather than showing the last one's. */}
                <JobOverview key={selected.id} jobId={selected.id} />
              </>
            ) : (
              <EmptyState>Pick a job from the list, a ring or the map.</EmptyState>
            )}
          </div>
          <Card className="self-start">
            {jobs ? <LopezMap jobs={jobs} selectedId={selectedId} onSelect={pick} /> : <Loading />}
          </Card>
        </div>
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
 * The top row's rings card, one fixed height whatever it holds: Total, Bills
 * and Labor; a legend that scrolls inside the card; the Bills and Labor rings.
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
    <Card className="flex flex-col gap-4 lg:h-52 lg:flex-row lg:gap-8">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
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
      <div className="flex shrink-0 justify-center gap-6">
        <Donut
          title="Bills"
          slices={slices("bills")}
          emptyLabel="No bills"
          size={112}
          legend={false}
          onSelect={onSelect}
        />
        <Donut
          title="Labor"
          slices={slices("labor")}
          emptyLabel="No labor"
          size={112}
          legend={false}
          onSelect={onSelect}
        />
      </div>
    </Card>
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
  const rows =
    scope === "month" ? monthRows : toDate && withDrafts(toDate, monthRows);
  if (!rows) return <Skeleton className="h-52 w-full rounded-xl" />;
  return (
    <RingsCard
      caption={jobLabel(job)}
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
