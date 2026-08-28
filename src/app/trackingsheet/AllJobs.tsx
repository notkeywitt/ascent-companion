"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { useCopy } from "@/components/CopyProvider";
import { UncapturedBills } from "@/components/UncapturedBills";
import { monthOptions } from "./Roster";
import { AllBills } from "./AllBills";
import { DraftQueue } from "./DraftQueue";

/**
 * Tracking Sheets with no job selected — the two all-jobs views, and the switch
 * between them.
 *
 * They answer different questions and neither subsumes the other, which is why
 * both are here rather than merged:
 *
 *  - "This month" is scoped by DATE. It's the invoicing run: what does each job
 *    bill for the period, and is it on an invoice in JobTread yet.
 *  - "Needs coding" is scoped by STATUS. It's every draft bill anywhere, of any
 *    age — the only place a bill filed to the wrong month can still be found.
 *
 * Picking a job (global job bar, or "Code this job" on a card) leaves both and
 * opens the workbench: same route, `?jobId=`.
 */

type Tab = "month" | "drafts";

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

  const [tab, setTab] = useState<Tab>(params.get("tab") === "drafts" ? "drafts" : "month");
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

  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next);
      const q = new URLSearchParams(params.toString());
      if (next === "drafts") q.set("tab", "drafts");
      else q.delete("tab");
      router.replace(`/trackingsheet?${q.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    // "This month" is a single reading column. "Needs coding" becomes the
    // three-column workbench from xl up (see DraftQueue), which needs the same
    // wide canvas the job workbench uses — so the cap only lifts on that tab.
    <main
      className={`mx-auto w-full px-4 pb-24 pt-6 ${
        tab === "drafts" ? "max-w-2xl xl:max-w-[110rem]" : "max-w-2xl lg:max-w-[110rem]"
      }`}
    >
      <PageHeader
        title={c("page.recode.title")}
        description={c(tab === "month" ? "recode.header.descMonth" : "recode.header.descNeedsCoding")}
        actions={
          // Segmented control, matching the workbench's own By bill / By cost
          // code switch: one bordered track so the two read as a pair, with
          // thumb-sized segments on touch.
          <div className="flex shrink-0 gap-1 rounded-lg border border-line p-0.5 text-xs">
            {(
              [
                ["month", "This month"],
                ["drafts", "Needs coding"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => switchTab(id)}
                aria-pressed={tab === id}
                className={`inline-flex min-h-10 items-center rounded-md px-2.5 transition lg:min-h-0 lg:py-1 ${
                  tab === id
                    ? "bg-accent font-semibold text-accent-fg"
                    : "text-neutral-500 hover:text-accent dark:text-neutral-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
        className="!mb-4"
      />

      {/* Ingested bills that never reached JobTread at all — the step before
          either tab. They're missing from "This month" because they're on no
          invoice, and missing from "Needs coding" because they aren't even a
          JobTread draft yet, so neither view can surface them; nothing in the
          hourly sync touches them either (it only mirrors JobTread → sheet).
          Sits above the tab switch, and above the month picker inside Roster,
          because a stranded bill often carries the WRONG billing period —
          scoping it to the selected month is exactly how it stays hidden.
          Renders nothing when the queue is empty. */}
      <UncapturedBills />

      {tab === "month" ? (
        <AllBills ym={ym} setYm={setYm} />
      ) : (
        <DraftQueue />
      )}
    </main>
  );
}
