"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banner, Card, SectionHeading, Skeleton } from "@/components/ui";
import { Donut } from "@/components/Donut";
import { WORKING_PHASES, type JobRef } from "@/components/JobPicker";
import type { MonthJobCost } from "@/lib/monthCostByJob";
import { buildColorMap, buildSlices, withoutSalesTax } from "./CostDonuts";
import { money0 } from "./BillCodingCard";

/**
 * Tracking Sheets with no job selected — one card per job with cost in the
 * month, each carrying the job workbench's two month rings (bills and labor by
 * cost code, CostDonuts' cut and colour rules). The card layout is the home
 * board's (HomeJobBoard): a sideways row on a phone, a grid from `pad` up. A
 * card opens that job's workbench on the same month.
 *
 * Read-only, one fetch for every job (`useMonthJobs`, called by the page).
 * Every job in a WORKING_PHASES phase also gets a card, cost or not, after the
 * jobs with cost — read from the job picker's cached list. Those idle cards
 * stay here: "Check all Jobs" still runs on the jobs with cost or an invoice only.
 * Self-hiding when there is no job to show.
 */
export function MonthJobDonuts({
  jobs,
  error,
  ym,
  monthLabel,
}: {
  jobs: MonthJobCost[] | null;
  error: string;
  ym: string;
  monthLabel: string;
}) {
  const [open, setOpen] = useState<JobRef[] | null>(null);
  useEffect(() => {
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((j) => setOpen(j.jobs ?? []))
      .catch(() => setOpen([])); // the cards with cost still show
  }, []);

  if (error) return <Banner tone="error" className="mb-6">Job rings: {error}</Banner>;
  if (jobs === null || open === null) return <Skeleton className="mb-6 h-40 w-full rounded-xl" />;

  const seen = new Set(jobs.map((j) => j.jobId));
  const idle: MonthJobCost[] = open
    .filter((o) => !seen.has(o.id) && WORKING_PHASES.includes(o.phase ?? ""))
    .map((o) => ({
      jobId: o.id,
      jobName: o.name,
      customerName: o.customer ?? "",
      bills: 0,
      labor: 0,
      invoiced: 0,
      deposits: 0,
      rows: [],
    }))
    .sort((a, b) => a.jobName.localeCompare(b.jobName));
  const all = [...jobs, ...idle];
  if (all.length === 0) return null;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={<span className="text-[11px] tabular-nums text-neutral-500">{all.length}</span>}
      >
        {`Jobs · ${monthLabel}`}
      </SectionHeading>
      {/* The home board's row: sideways on a phone, bleeding to the screen edge
          so the next card shows cut off; a grid from `pad` up. */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pad:mx-0 pad:grid pad:grid-cols-2 pad:overflow-x-visible pad:px-0 xl:grid-cols-3 2xl:grid-cols-4">
        {all.map((j) => (
          <JobCard key={j.jobId} j={j} ym={ym} />
        ))}
      </div>
    </section>
  );
}

/** Every job with cost in the month — the ring cards and "Check all Jobs" share this one read. */
export function useMonthJobs(ym: string) {
  const [jobs, setJobs] = useState<MonthJobCost[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const [y, m] = ym.split("-");
    setJobs(null);
    setError("");
    fetch(`/api/trackingsheet/month-donuts?year=${y}&month=${Number(m)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else setJobs(j.jobs ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      alive = false;
    };
  }, [ym]);

  return { jobs, error };
}

function JobCard({ j, ym }: { j: MonthJobCost; ym: string }) {
  const rows = withoutSalesTax(j.rows);
  // Off the same rows as the rings, so the total leaves out 88 80 00 too.
  const total = rows.reduce((n, r) => n + r.bills + r.labor, 0);
  const colorMap = buildColorMap(rows);
  return (
    // `w-80` is the scroller's card; `pad:w-auto` lets the grid cell decide.
    <Card className="flex h-full w-80 shrink-0 flex-col gap-2 pad:w-auto">
      <Link
        href={`/trackingsheet?jobId=${encodeURIComponent(j.jobId)}&ym=${encodeURIComponent(ym)}`}
        className="flex flex-1 flex-col gap-3 rounded-lg transition hover:opacity-80"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">{j.jobName}</div>
            <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {j.customerName || "—"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[13px] font-bold tabular-nums text-accent dark:text-accent-soft">
              {money0(total)}
            </div>
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              This month
            </div>
            {/* The month's client invoices, net of applied deposits — smaller
                than the cost figure above, and absent until one is sent. */}
            {(j.invoiced !== 0 || j.deposits !== 0) && (
              <div className="mt-1 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                <span className="font-semibold">{money0(j.invoiced)}</span> invoiced
                {j.deposits !== 0 && (
                  <div className="text-[9.5px]">after {money0(j.deposits)} deposit</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Donut
            title="Bills"
            slices={buildSlices(rows, colorMap, "bills")}
            size={96}
            emptyLabel="No bills"
          />
          <Donut
            title="Labor"
            slices={buildSlices(rows, colorMap, "labor")}
            size={96}
            emptyLabel="No labor"
          />
        </div>
      </Link>
    </Card>
  );
}
