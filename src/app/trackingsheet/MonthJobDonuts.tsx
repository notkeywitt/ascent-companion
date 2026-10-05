"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banner, Card, SectionHeading, Skeleton } from "@/components/ui";
import { Donut } from "@/components/Donut";
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
 * Read-only, one fetch for every job. Self-hiding when the month has no cost.
 */
export function MonthJobDonuts({ ym, monthLabel }: { ym: string; monthLabel: string }) {
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

  if (error) return <Banner tone="error" className="mb-6">Job rings: {error}</Banner>;
  if (jobs === null) return <Skeleton className="mb-6 h-40 w-full rounded-xl" />;
  if (jobs.length === 0) return null;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={<span className="text-[11px] tabular-nums text-neutral-500">{jobs.length}</span>}
      >
        {`Jobs with cost · ${monthLabel}`}
      </SectionHeading>
      {/* The home board's row: sideways on a phone, bleeding to the screen edge
          so the next card shows cut off; a grid from `pad` up. */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pad:mx-0 pad:grid pad:grid-cols-2 pad:overflow-x-visible pad:px-0 xl:grid-cols-3 2xl:grid-cols-4">
        {jobs.map((j) => (
          <JobCard key={j.jobId} j={j} ym={ym} />
        ))}
      </div>
    </section>
  );
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
