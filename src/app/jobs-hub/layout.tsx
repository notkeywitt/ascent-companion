import { Suspense } from "react";
import { currentBillingPeriod } from "@/lib/billingMonth";
import { PageSkeleton } from "@/components/ui";
import { JobsHub } from "./JobsHub";

/**
 * Jobs Hub — Home's job board, the Job Board's rows and the Lopez Island map on
 * one desktop screen. Gated by the "jobs-hub" view in src/lib/views.ts
 * (office + admin).
 *
 * The hub lives in this LAYOUT, not in a page. A page remounts whenever the
 * router moves to a new query or path (a link with ?jobId=, a /jobs-hub/<job>
 * link), which reloaded the list, the job card and the map behind a skeleton.
 * A layout stays mounted through those moves; JobsHub reads the address itself
 * (`useSearchParams`, src/lib/hubUrl.ts). The pages under it render nothing.
 */
export default async function JobsHubLayout() {
  const { billingYear, billingMonthNum } = await currentBillingPeriod();
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobsHub billingYm={`${billingYear}-${String(billingMonthNum).padStart(2, "0")}`} />
    </Suspense>
  );
}
