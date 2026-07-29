import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getJobs } from "@/lib/jobtread";
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

// Read-only: the org's open jobs, for the project picker.
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const jobs = await getCachedJobs();
    return NextResponse.json({ jobs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
