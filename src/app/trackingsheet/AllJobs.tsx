"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { useCopy } from "@/components/CopyProvider";
import { UncapturedBills } from "@/components/UncapturedBills";
import { monthOptions } from "./Roster";
import { AllBills } from "./AllBills";

/**
 * Tracking Sheets with no job selected — every vendor bill issued in the
 * selected month across all jobs (draft, uninvoiced, and invoiced alike, each
 * tagged with its state). Picking a job (global job bar, or a bill's own detail
 * page) opens the workbench: same route, `?jobId=`.
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
  const c = useCopy();

  // Seeded from the URL so returning from a bill lands on the month you left.
  const [ym, setYmState] = useState(() => {
    const q = params.get("ym") ?? "";
    return monthOptions().some((o) => o.ym === q) ? q : defaultYm();
  });

  /**
   * The month lives in the URL as well as in state, so "Code this job" and the
   * global job bar can carry it into the workbench. `replace`, not `push` — a
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

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader title={c("page.recode.title")} className="!mb-4" />

      {/* Ingested bills that never reached JobTread at all — the step before the
          list. They're on no invoice and aren't even a JobTread draft yet, so
          the month view can't surface them; nothing in the hourly sync touches
          them either (it only mirrors JobTread → sheet). Sits above the month
          picker inside the list, because a stranded bill often carries the WRONG
          billing period — scoping it to the selected month is exactly how it
          stays hidden. Renders nothing when the queue is empty. */}
      <UncapturedBills />

      <AllBills ym={ym} setYm={setYm} />
    </main>
  );
}
