"use client";

import { Card, SectionHeading } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { UncapturedBills } from "@/components/UncapturedBills";
import { DriveSyncStatus } from "@/components/SyncNowButton";
import { SheetSyncButton } from "@/components/SheetSyncSettings";
import { AllBills } from "@/app/trackingsheet/AllBills";
import { UnsyncedDrafts } from "@/app/trackingsheet/UnsyncedDrafts";

/**
 * The hub's Month view: what /trackingsheet showed with no job picked (retired
 * 2026-11-14). The month's rings and actions are the header; this is the work
 * under them — bills that never reached JobTread, coding left unsaved, every
 * bill and time entry of the month, and the two company-wide sync controls.
 */
export function MonthWork({ ym }: { ym: string }) {
  const { can } = useAccess();
  return (
    <div>
      <UncapturedBills />
      <UnsyncedDrafts />
      <AllBills ym={ym} />
      {can("sync") && (
        <section className="mt-6">
          <SectionHeading className="mb-2">Company tools</SectionHeading>
          <Card pad={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                All of JobTread into the Sheet and Drive tree: projects, vendors, bills, PDFs, the
                expenditure summary. Runs hourly on its own.
              </span>
              <DriveSyncStatus className="shrink-0" />
            </div>
            {can("tracking-sheet") && (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line-soft px-4 py-3">
                <span className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                  Pause the automatic tracking-sheet sync, or pin the month the sheets hold.
                </span>
                <SheetSyncButton ym={ym} className="min-h-11 shrink-0" />
              </div>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
