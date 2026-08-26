import { unstable_cache } from "next/cache";

import { getJobPhaseMap, getJobs } from "@/lib/jobtread";
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
