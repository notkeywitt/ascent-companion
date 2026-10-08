"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Card, Chip, SectionHeading } from "@/components/ui";
import type { MonthJobCost } from "@/lib/monthCostByJob";
import type { Finding } from "@/lib/invoiceReview/types";
import { useJobChecks } from "./usePreSendCheck";
import { JobFindings, sourceLinkOf, type FindingLink } from "./PreSendCheck";
import { BillPopup } from "./BillPopup";
import type { Selection } from "./DraftWorkbench";
import { laborFocusHref } from "./findingFocus";
import { checkedAtLabel, openFindings, tally } from "./preSendMemory";

/**
 * "Check all Jobs" on the all-jobs view — the workbench's "Check this job",
 * run once per job with cost in the month. Same route, same checks, one call
 * per job; nothing month-wide is added. The run, its memory and the three-at-
 * a-time pacing are useJobChecks (usePreSendCheck.ts), which the board's own
 * "Check this job" shares — a job checked there shows here, and the reverse.
 */
export function useCheckAllJobs(jobs: MonthJobCost[] | null, ym: string) {
  const jc = useJobChecks(
    ym,
    (jobs ?? []).map((j) => j.jobId),
  );
  const { checkAll } = jc;
  const run = useCallback(() => checkAll((jobs ?? []).map((j) => j.jobId)), [jobs, checkAll]);
  return { ...jc, run, running: jc.batchRunning };
}

type CheckAll = ReturnType<typeof useCheckAllJobs>;

/**
 * The results, one row per job checked. Renders nothing until a job has a
 * check, this session or a previous one on this device.
 *
 * Each finding row opens what it is about: a bill opens in a popup over this
 * list (BillPopup), a labor finding opens the job's board with its labor list
 * narrowed to the person or cost code and the entries ticked (findingFocus.ts).
 * Anything else follows the finding's own link. The list is kept per device
 * and month, so coming back from the board finds it where it was.
 */
export function CheckAllResults({
  jobs,
  check,
  ym,
  monthLabel,
}: {
  jobs: MonthJobCost[] | null;
  check: CheckAll;
  ym: string;
  monthLabel: string;
}) {
  const [popup, setPopup] = useState<Selection | null>(null);
  const rows = (jobs ?? []).filter((j) => {
    const r = check.runs[j.jobId];
    return r && (r.mem || r.state !== "idle" || r.error);
  });
  if (!rows.length) return null;

  const linkFor =
    (job: MonthJobCost) =>
    (f: Finding): FindingLink | null => {
      const t = f.target;
      if (t?.kind === "bill") {
        return {
          label: "Open the bill",
          onClick: () =>
            setPopup({ docId: t.billId, jobId: job.jobId, label: f.title, jobName: job.jobName }),
        };
      }
      if (t?.kind === "labor")
        return { label: "Open the labor list", href: laborFocusHref(job.jobId, ym, t) };
      return sourceLinkOf(f);
    };

  return (
    <>
      <section className="mb-6 space-y-2">
        <SectionHeading
          trailing={
            check.total > 0 ? (
              <span className="text-[11px] tabular-nums text-neutral-500">
                {check.finished}/{check.total}
              </span>
            ) : undefined
          }
        >
          {`Job checks · ${monthLabel}`}
        </SectionHeading>
        <Card pad={false} className="overflow-hidden">
          <ul className="divide-y divide-line-soft">
            {rows.map((j) => {
              const c = check.runs[j.jobId];
              const mem = c.mem;
              const r = mem?.result;
              const { errors, warnings } = mem ? tally(mem) : { errors: 0, warnings: 0 };
              const open = mem ? openFindings(mem) : [];
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
                      {c.state === "queued" && "Waiting"}
                      {c.state === "running" && "Checking…"}
                      {c.error && <Chip tone="danger">Check failed</Chip>}
                      {r && c.state === "idle" && (
                        <>
                          {/* A check that could not read the job must never read as clean. */}
                          {r.evidenceWarnings.length > 0 && <Chip tone="danger">Incomplete</Chip>}
                          {errors > 0 && <Chip tone="danger">{errors} to fix</Chip>}
                          {warnings > 0 && <Chip tone="warning">{warnings} to look at</Chip>}
                          {!open.length &&
                            !r.evidenceWarnings.length &&
                            (mem.fixed.length || mem.cleared.length
                              ? "Nothing left open"
                              : r.empty
                                ? "Nothing to check"
                                : "Nothing to fix")}
                          <span className="tabular-nums">· {checkedAtLabel(mem.at)}</span>
                        </>
                      )}
                    </span>
                  </div>
                  {c.error && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{c.error}</p>
                  )}
                  {r?.evidenceWarnings.length ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {r.evidenceWarnings.join(" · ")}
                    </p>
                  ) : null}
                  <JobFindings
                    run={c}
                    linkFor={linkFor(j)}
                    onRecheck={(key) => void check.check(j.jobId, key)}
                    onClear={(key) => check.clear(j.jobId, key)}
                    onUnclear={() => check.unclear(j.jobId)}
                    className="mt-1"
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
      {/* Outside the section: its space-y margin would push a fixed overlay down. */}
      {popup && <BillPopup sel={popup} onClose={() => setPopup(null)} />}
    </>
  );
}
