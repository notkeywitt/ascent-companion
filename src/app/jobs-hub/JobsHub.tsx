"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
} from "@/components/ui";
import { MonthTotalCard, useMonthJobs } from "@/app/trackingsheet/MonthJobDonuts";
import { PHASE_COLORS, type MapJob } from "@/lib/lopezMap";
import { money0 } from "@/lib/money";

/**
 * Jobs Hub — the desktop screen for every job at once (owner, 2026-11-01; the
 * Figma draft is "Ascent — Jobs Hub (desktop draft)").
 *
 *   • Left: ONE continuous list of the working jobs (Active, then PreCon), a
 *     line each — name, phase, and this billing month's amount to invoice
 *     (owner: "smaller, less detail, a single list").
 *   • Right: the month's all-jobs rings (Tracking Sheets' MonthTotalCard), then
 *     the picked job's overview (cost by division, schedule) beside the Lopez
 *     Island map. A row or a dot picks the job.
 *
 * Read-only. Every write stays on the page it lives on.
 */

/** The working phases, in list order — the ones the map colours. */
const WORKING = [...new Set(PHASE_COLORS.map((p) => p.phase))];

interface ToInvoice {
  ym: string;
  totals: Record<string, number>;
}

export function JobsHub() {
  const canTrackingSheet = useAccess().can("recode");
  const [jobs, setJobs] = useState<MapJob[] | null>(null);
  const [toInvoice, setToInvoice] = useState<ToInvoice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => !cancelled && setJobs([]));
    // One fetch for the whole list: the route scans the month's every bill and
    // time entry. A failure just leaves the amounts off.
    fetch("/api/jobs/to-be-invoiced")
      .then((r) => r.json())
      .then((d) => !cancelled && !d?.error && setToInvoice({ ym: d.ym ?? "", totals: d.totals ?? {} }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const working = (jobs ?? [])
    .filter((j) => WORKING.includes(j.phase ?? ""))
    .sort((a, b) => WORKING.indexOf(a.phase ?? "") - WORKING.indexOf(b.phase ?? "") || a.name.localeCompare(b.name));
  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  const pick = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  return (
    <main className="w-full px-4 pb-10 pt-5 pad:px-7">
      <PageHeader title="Jobs Hub" description="Every working job on one screen — this month's money, the island map, and one job in detail." />
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
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
                return (
                  <ListRow
                    key={j.id}
                    label={j.name}
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

        <div className="min-w-0 space-y-6">
          {toInvoice?.ym && <MonthRings ym={toInvoice.ym} />}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-3">
              {selected ? (
                <>
                  <Card className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-base font-semibold tracking-tight">{selected.name}</div>
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
                <EmptyState>Pick a job from the list or the map.</EmptyState>
              )}
            </div>
            <Card className="self-start">
              {jobs ? <LopezMap jobs={jobs} selectedId={selectedId} onSelect={pick} /> : <Loading />}
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Tracking Sheets' all-jobs card for the billing month: bills and labor, ring per kind. */
function MonthRings({ ym }: { ym: string }) {
  const { jobs } = useMonthJobs(ym);
  if (!jobs?.length) return null;
  return <MonthTotalCard jobs={jobs} ym={ym} />;
}
