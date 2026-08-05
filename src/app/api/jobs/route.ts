import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getJobPhaseMap, getJobs } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Shared, cold-start-proof cache for the org's open jobs. JobPicker fetches this on
// nearly every office page (and requisitions / mileage fetch it again), yet jobs are
// reference data created in JobTread — never edited via the Companion (clearJtRefCache is
// unused, so TTL-only is already the accepted freshness model). getJobs' own cache is an
// in-memory Map that dies on cold start and isn't shared between lambdas; unstable_cache
// serves repeat loads from Next's Data Cache (shared + persistent), so the JobTread
// pagination runs at most once per window instead of once per lambda/cold start.
const getCachedJobs = unstable_cache(() => getJobs(getPaveConfig()), ["api-jobs-open"], {
  revalidate: 300,
  tags: ["jt-jobs"],
});

// Same open-jobs list, PLUS each job's "Phase" custom field — a separate cache
// entry (not the default GET path) so the plain, far-more-common /api/jobs read
// doesn't pay for the extra customFieldValues join. Used by JobPicker's opt-in
// Phase filter (?withPhase=1). Deliberately still OPEN jobs only, unlike
// /api/jobs/browser (/jobs' reporting view, which also wants closed jobs) — the
// header's app-wide picker should keep its existing "open jobs" scope.
const getCachedJobsWithPhase = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [jobs, phases] = await Promise.all([getJobs(cfg), getJobPhaseMap(cfg)]);
    return jobs.map((j) => ({ ...j, phase: phases[j.id] ?? null }));
  },
  ["api-jobs-open-with-phase"],
  { revalidate: 300, tags: ["jt-jobs"] },
);

// Read-only: the org's open jobs, for the project picker. ?withPhase=1 joins
// each job's Phase custom field for callers that filter by it.
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const withPhase = req.nextUrl.searchParams.get("withPhase") === "1";
    const jobs = await (withPhase ? getCachedJobsWithPhase() : getCachedJobs());
    return NextResponse.json({ jobs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
