import { unstable_cache } from "next/cache";

import {
  getJobPhaseMap,
  getJobs,
  getMonthlyInvoiceJobs,
  getMonthlyInvoiceTime,
} from "@/lib/jobtread";
import { getPaveConfig } from "@/lib/config";

/**
 * The org's open jobs, cached in Next's Data Cache (shared between lambdas and
 * across cold starts, unlike getJobs' own in-memory Map).
 *
 * It lives here, not inside /api/jobs, so a SERVER COMPONENT can preload the
 * same list into its HTML and hit the SAME cache entry the route serves — a
 * page that renders the picker with jobs already in it costs one cache read
 * (~10 ms warm), not a client round trip. Jobs are reference data created in
 * JobTread and never edited from the Companion, so a TTL is the whole freshness
 * model.
 */
export const getCachedJobs = unstable_cache(() => getJobs(getPaveConfig()), ["api-jobs-open"], {
  revalidate: 300,
  tags: ["jt-jobs"],
});

/**
 * Same open-jobs list, PLUS each job's "Phase" custom field — a separate cache
 * entry (not the default path) so the plain, far-more-common read doesn't pay
 * for the extra customFieldValues join. Used by JobPicker's opt-in Phase filter
 * (?withPhase=1). Deliberately still OPEN jobs only, unlike /api/jobs/browser
 * (/jobs' reporting view, which also wants closed jobs) — the header's app-wide
 * picker keeps its existing "open jobs" scope.
 */
export const getCachedJobsWithPhase = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [jobs, phases] = await Promise.all([getJobs(cfg), getJobPhaseMap(cfg)]);
    return jobs.map((j) => ({ ...j, phase: phases[j.id] ?? null }));
  },
  ["api-jobs-open-with-phase"],
  { revalidate: 300, tags: ["jt-jobs"] },
);

/**
 * Per-job uninvoiced BILL totals for one billing month — half of the figure the
 * header's job picker prints beside each job. Uninvoiced bills only, drafts
 * included: the same two defaults the Tracking Sheets month view uses, so the
 * picker and that page can't disagree. The other half is the time below.
 *
 * Cached like the jobs list, and for a stronger reason: the scan pages every
 * vendor bill the org issued in the month, far too slow to re-run on each open.
 */
export const getCachedMonthlyInvoiceJobs = unstable_cache(
  (year: number, month: number) => getMonthlyInvoiceJobs(getPaveConfig(), year, month, false, true),
  ["job-picker-to-be-invoiced"],
  { revalidate: 300, tags: ["jt-bills"] },
);

/**
 * Per-job uninvoiced TIME cost for the same billing month — the rest of the
 * picker's "to be invoiced" figure. A client invoice pulls labor along with the
 * bills, so the picker adds this to the bill total above.
 *
 * A SEPARATE cache entry from the bill scan on purpose: the two walks are
 * independent, and a time walk that fails should not throw away a bill scan the
 * picker can still show.
 */
export const getCachedMonthlyInvoiceTime = unstable_cache(
  (year: number, month: number) => getMonthlyInvoiceTime(getPaveConfig(), year, month),
  ["job-picker-to-be-invoiced-time"],
  { revalidate: 300, tags: ["jt-bills"] },
);
