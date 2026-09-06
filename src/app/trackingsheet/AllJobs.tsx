"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, PageHeader, SectionHeading } from "@/components/ui";
import { JobPicker } from "@/components/JobPicker";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { UncapturedBills } from "@/components/UncapturedBills";
import { SyncNowButton } from "@/components/SyncNowButton";
import { LaborReportButton } from "@/components/LaborReportButton";
import { monthOptions } from "./Roster";
import { AllBills } from "./AllBills";
import { UnsyncedDrafts } from "./UnsyncedDrafts";

/**
 * Tracking Sheets with no job selected — every vendor bill issued in the
 * selected month across all jobs (draft, uninvoiced, and invoiced alike, each
 * tagged with its state). Picking a job opens the workbench: same route,
 * `?jobId=`.
 *
 * THE TITLE IS THE JOB PICKER, exactly as it is on the workbench — the same
 * control in the same place, reading the page's own name while nothing is
 * picked. Without it this view was a dead end: the app-wide picker left the
 * header, so a job could only be reached by finding one of its bills in the
 * month's list.
 */

/**
 * Default billing month — the 10th-to-10th window: through the 10th we're still
 * closing out the PREVIOUS month; from the 11th on, the current one. (Jul 10 →
 * June, Jul 11 → July.) Day ≤ 10 is always valid in the prior month, so stepping
 * the month back can't overflow.
 */
function defaultYm(): string {
  const d = new Date();
  if (d.getDate() <= 10) d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function AllJobs() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useAccess();
  const c = useCopy();

  // Seeded from the URL so returning from a bill lands on the month you left.
  const [ym, setYmState] = useState(() => {
    const q = params.get("ym") ?? "";
    return monthOptions().some((o) => o.ym === q) ? q : defaultYm();
  });

  /**
   * The month lives in the URL as well as in state, so "Code this job" can
   * carry it into the workbench. `replace`, not `push` — a
   * month picker shouldn't fill the back button with one entry per change.
   */
  const setYm = useCallback(
    (next: string) => {
      setYmState(next);
      const q = new URLSearchParams(params.toString());
      q.set("ym", next);
      router.replace(`/trackingsheet?${q.toString()}`, { scroll: false });
    },
    [params, router],
  );

  /**
   * Picking a job from the title opens its workbench, carrying the month you
   * were looking at so you land on the same billing period. Empty id is the
   * "All jobs" row, which is this view — nothing to do.
   */
  const onPickJob = (id: string) => {
    if (!id) return;
    router.push(`/trackingsheet?jobId=${encodeURIComponent(id)}&ym=${encodeURIComponent(ym)}`);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 xl:max-w-[110rem]">
      <PageHeader
        titleSlot={
          <div className="flex min-w-0 flex-1 flex-col">
            <JobPicker
              variant="title"
              value=""
              onChange={onPickJob}
              placeholder={c("page.recode.title")}
              allLabel="All jobs"
              allDescription="Every job's month, side by side"
              showPhaseFilter
              showToBeInvoiced={can("recode")}
            />
          </div>
        }
        className="!mb-4"
      />

      {/* Ingested bills that never reached JobTread at all — the step before the
          list. They're on no invoice and aren't even a JobTread draft yet, so
          the month view can't surface them; nothing in the hourly sync touches
          them either (it only mirrors JobTread → sheet). Sits above the month
          picker inside the list, because a stranded bill often carries the WRONG
          billing period — scoping it to the selected month is exactly how it
          stays hidden. Renders nothing when the queue is empty. */}
      <UncapturedBills />

      {/* Where you left off — coding staged in this app that never reached
          JobTread, on any device. Below the uncaptured queue (a bill missing
          from JobTread entirely outranks one you simply haven't finished) and
          above the month, because like that queue it is not scoped to a month:
          unfinished work from July is exactly the kind the month picker would
          hide. Renders nothing when there is none. */}
      <UnsyncedDrafts />

      <AllBills ym={ym} setYm={setYm} />

      {/* COMPANY-WIDE TOOLS — the two actions that take no job at all. Both used
          to sit on the job workbench: the Drive sync in its closing row beside
          two job-and-month buttons, and the Labor Report inside that job's own
          "Time & labor" card. Neither reads the job on screen, and sitting among
          controls that do is what made them read as job actions. This is the
          all-jobs view, so it is the one place on this page where "every job" is
          already the subject.

          Each is a row with its scope written beside it, rather than a bare
          button: what they touch is exactly the thing a label on a pill cannot
          say. */}
      <section className="mt-6">
        <SectionHeading className="mb-2">Company tools</SectionHeading>
        <Card pad={false} className="overflow-hidden">
          {can("sync") && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3 last:border-b-0">
              <span className="min-w-0 flex-1 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                Pull all of JobTread into the Sheet and Drive tree now. Runs hourly on its own;
                this only asks for it early.
              </span>
              <SyncNowButton className="min-h-11 shrink-0" />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
            <span className="min-w-0 flex-1 text-[11.5px] text-neutral-500 dark:text-neutral-400">
              Every job&apos;s hours for the selected month, filed as one sheet in the Drive Labor
              folder. Not scoped to a job or to the list above.
            </span>
            <LaborReportButton ym={ym} size="md" className="shrink-0 items-end text-right" />
          </div>
        </Card>
      </section>
    </main>
  );
}
