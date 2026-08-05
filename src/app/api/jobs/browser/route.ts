import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getJobs, getJobPhaseMap } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: every job in the org (open AND closed) with its "Phase" custom
 * field, for the /jobs browser's dropdown + Phase filter.
 *
 * Separate from /api/jobs on purpose: that one is the picker's list of OPEN jobs
 * and is fetched on nearly every office page, so it stays lean. This one carries
 * the extra Phase join and includes closed jobs (the browser is a reporting view
 * — a finished job's costs are exactly what you go looking for).
 *
 * Doing the join here instead of in the browser is the load-time fix: the client
 * used to page organization.jobs (up to 10 gateway round trips) and then page the
 * Status custom field (up to 20 more) on every single page load. Now it is one
 * fetch, served from Next's shared Data Cache — same pattern as /api/jobs.
 */
const getCachedJobBrowserList = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [jobs, phases] = await Promise.all([getJobs(cfg, true), getJobPhaseMap(cfg)]);
    return jobs.map((j) => ({ ...j, phase: phases[j.id] ?? null }));
  },
  ["api-jobs-browser"],
  { revalidate: 300, tags: ["jt-jobs"] },
);

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const jobs = await getCachedJobBrowserList();
    return NextResponse.json({ jobs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
