"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, Chip, SectionHeading } from "@/components/ui";
import { createTaskRunner } from "@/lib/taskRunner";
import type { MonthJobCost } from "@/lib/monthCostByJob";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";
import { fetchPreSend } from "./usePreSendCheck";
import { FindingList } from "./PreSendCheck";

/**
 * "Check all Jobs" on the all-jobs view — the workbench's "Check this job",
 * run once per job with cost in the month. Same route, same checks, one call
 * per job; nothing month-wide is added.
 *
 * Three at a time: each check is several JobTread round trips, and firing a
 * whole month at once only queues them behind the rate limit.
 */
type JobCheck = { status: "queued" | "running" | "done" | "error"; result?: PreSendResult; error?: string };

export function useCheckAllJobs(jobs: MonthJobCost[] | null, ym: string) {
  const [checks, setChecks] = useState<Record<string, JobCheck>>({});
  // Bumped by every run and every month change, so a check still in flight
  // from an older run cannot write into the one on screen.
  const runId = useRef(0);

  useEffect(() => {
    runId.current++;
    setChecks({});
  }, [ym]);

  const run = useCallback(() => {
    if (!jobs?.length) return;
    const id = ++runId.current;
    const set = (jobId: string, c: JobCheck) => {
      if (runId.current === id) setChecks((prev) => ({ ...prev, [jobId]: c }));
    };
    setChecks(Object.fromEntries(jobs.map((j) => [j.jobId, { status: "queued" }])));
    const runner = createTaskRunner(3);
    for (const j of jobs) {
      runner.run(j.jobId, async () => {
        set(j.jobId, { status: "running" });
        try {
          set(j.jobId, { status: "done", result: await fetchPreSend(j.jobId, ym) });
        } catch (e) {
          set(j.jobId, { status: "error", error: e instanceof Error ? e.message : "The check failed." });
        }
      });
    }
  }, [jobs, ym]);

  const list = Object.values(checks);
  const finished = list.filter((c) => c.status === "done" || c.status === "error").length;
  const running = list.length > 0 && finished < list.length;
  return { checks, run, running, finished, total: list.length };
}

/** The results, one row per job checked. Renders nothing until a run starts. */
export function CheckAllResults({
  jobs,
  checks,
  finished,
  total,
  ym,
  monthLabel,
}: {
  jobs: MonthJobCost[] | null;
  checks: Record<string, JobCheck>;
  finished: number;
  total: number;
  ym: string;
  monthLabel: string;
}) {
  const rows = (jobs ?? []).filter((j) => checks[j.jobId]);
  if (!rows.length) return null;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        trailing={
          <span className="text-[11px] tabular-nums text-neutral-500">
            {finished}/{total}
          </span>
        }
      >
        {`Job checks · ${monthLabel}`}
      </SectionHeading>
      <Card pad={false} className="overflow-hidden">
        <ul className="divide-y divide-line-soft">
          {rows.map((j) => {
            const c = checks[j.jobId];
            const r = c.result;
            const live = (r?.findings ?? []).filter((f) => !f.suppressedBy);
            return (
              <li key={j.jobId} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/trackingsheet?jobId=${encodeURIComponent(j.jobId)}&ym=${encodeURIComponent(ym)}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent"
                  >
                    {j.jobName}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {c.status === "queued" && "Waiting"}
                    {c.status === "running" && "Checking…"}
                    {c.status === "error" && <Chip tone="danger">Check failed</Chip>}
                    {r && (
                      <>
                        {/* A check that could not read the job must never read as clean. */}
                        {r.evidenceWarnings.length > 0 && <Chip tone="danger">Incomplete</Chip>}
                        {r.errors > 0 && <Chip tone="danger">{r.errors} to fix</Chip>}
                        {r.warnings > 0 && <Chip tone="warning">{r.warnings} to look at</Chip>}
                        {!live.length &&
                          !r.evidenceWarnings.length &&
                          (r.empty ? "Nothing to check" : "Nothing to fix")}
                      </>
                    )}
                  </span>
                </div>
                {c.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{c.error}</p>}
                {r?.evidenceWarnings.length ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {r.evidenceWarnings.join(" · ")}
                  </p>
                ) : null}
                {live.length > 0 && <FindingList findings={live} className="mt-1" />}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
