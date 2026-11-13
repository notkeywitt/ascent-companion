import { currentBillingPeriod } from "@/lib/billingMonth";
import { JobsHub } from "./JobsHub";

/**
 * Jobs Hub — Home's job board, the Job Board's rows and the Lopez Island map on
 * one desktop screen. Gated by the "jobs-hub" view in src/lib/views.ts
 * (office + admin).
 */
export default async function JobsHubPage() {
  const { billingYear, billingMonthNum } = await currentBillingPeriod();
  return <JobsHub billingYm={`${billingYear}-${String(billingMonthNum).padStart(2, "0")}`} />;
}
