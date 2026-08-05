import { NextResponse } from "next/server";
import { getJobCostDetail } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: one job's cost tree (CSI division → cost code → estimate line) for
 * the /jobs browser.
 *
 * Deliberately NOT wrapped in unstable_cache. Unlike the jobs list, this moves
 * whenever a bill is approved or the budget is edited in JobTread, so it rides
 * the same freshness model the bill view uses: a 60 s in-process cache inside
 * getJobCostDetail, dropped by clearJobCostCaches() on every bill write.
 */
export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }
  try {
    const detail = await getJobCostDetail(getPaveConfig(), jobId);
    return NextResponse.json(detail);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
