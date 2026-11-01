"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  Skeleton,
} from "@/components/ui";
import { CostDonuts, type CostDonutRow } from "@/app/trackingsheet/CostDonuts";
import { MonthTotalCard, monthJobRows, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import { monthLabel } from "@/lib/billingMonths";
import { PHASE_COLORS, type MapJob } from "@/lib/lopezMap";
import { money0 } from "@/lib/money";

/**
 * Jobs Hub — the desktop screen for every job at once (owner, 2026-11-01; the
 * Figma draft is "Ascent — Jobs Hub (desktop draft)").
 *
 *   • Top, full width: the rings. No job picked — the billing month's all-jobs
 *     Bills and Labor rings (Tracking Sheets' MonthTotalCard), with no legend:
 *     the job list below carries each job's swatch. A job picked — that job's
 *     rings by cost code (CostDonuts), whose caption switches between the month
 *     and the job to date.
 *   • Left: ONE continuous list of the working jobs (Active, then PreCon), a
 *     line each — "Customer - Job", phase, the month's amount to invoice.
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
      .then((d) => !cancelled && !d?.error && setToInvoice({ ym: d.ym ?? "", totals: d.totals ?? {} }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const ym = toInvoice?.ym ?? "";
  const { jobs: monthJobs } = useMonthJobs(ym);
  const colors = useMemo(
    () => new Map(monthJobRows(monthJobs ?? []).map((r) => [r.key, r.color])),
    [monthJobs],
  );

  const working = (jobs ?? [])
    .filter((j) => WORKING.includes(j.phase ?? ""))
    .sort(
      (a, b) =>
        WORKING.indexOf(a.phase ?? "") - WORKING.indexOf(b.phase ?? "") || jobLabel(a).localeCompare(jobLabel(b)),
    );
  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  const pick = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  return (
    <main className="w-full px-4 pb-10 pt-5 pad:px-7">
      <PageHeader title="Jobs Hub" description="Every working job on one screen — this month's money, the island map, and one job in detail." />

      <div className="mb-6">
        {selected ? (
          <JobRings key={selected.id} job={selected} ym={ym} monthRows={monthJobs?.find((j) => j.jobId === selected.id)?.rows ?? []} />
        ) : monthJobs ? (
          <MonthTotalCard jobs={monthJobs} ym={ym} legend={false} onSelect={pick} />
        ) : (
          <Skeleton className="h-48 w-full rounded-xl" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <SectionHeading trailing={<span className="text-[11px] tabular-nums text-neutral-500">{working.length}</span>}>
            Jobs
          </SectionHeading>
          {!jobs ? (
            <Loading />
          ) : working.length === 0 ? (
            <EmptyState>No job has Phase set to Active or PreCon.</EmptyState>
          ) : (
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
                    trailing={owed > 0 ? <span className="text-[12px] tabular-nums">{money0(owed)}</span> : undefined}
                    selected={j.id === selectedId}
                    chevron={false}
                    onClick={() => pick(j.id)}
                  />
                );
              })}
            </ListCard>
          )}
        </aside>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-3">
            {selected ? (
              <>
                <Card className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-base font-semibold tracking-tight">{jobLabel(selected)}</div>
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

/**
 * One job's rings by cost code. The month comes from the all-jobs read already
 * in hand; the job to date is the cost tree's codes (/api/jobs/cost-detail,
 * cached server-side, the same read the overview below makes).
 */
function JobRings({ job, ym, monthRows }: { job: HubJob; ym: string; monthRows: CostDonutRow[] }) {
  const [toDate, setToDate] = useState<CostDonutRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(job.id)}`)
      .then((r) => r.json())
      .then((d: { error?: string; divisions?: { codes: { number: string; name: string; bills: number; labor: number }[] }[] }) => {
        if (cancelled) return;
        setToDate(
          (d.divisions ?? []).flatMap((dv) =>
            dv.codes.map((c) => ({ code: c.number, name: c.name, bills: c.bills, labor: c.labor })),
          ),
        );
      })
      .catch(() => !cancelled && setToDate([]));
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  if (!toDate) return <Skeleton className="h-48 w-full rounded-xl" />;
  return (
    <Card>
      <div className="mb-2 text-sm font-semibold tracking-tight">{jobLabel(job)}</div>
      <CostDonuts month={monthRows} jobToDate={toDate} monthLabel={ym ? monthLabel(ym) : ""} />
      {!monthRows.length && !toDate.some((r) => r.bills || r.labor) && (
        <p className="text-[12px] text-neutral-500">No bills or labor on this job yet.</p>
      )}
    </Card>
  );
}
