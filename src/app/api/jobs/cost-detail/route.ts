import { NextResponse } from "next/server";
import { getJobCostDetail } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { FORBIDDEN, holdsAnyView } from "@/lib/apiAuth";

/** The views whose pages read a job's cost: Tracking Sheets, Job Cost, Labor. */
const COST_VIEWS = ["recode", "jobs", "labor"];

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
  // Every figure here is money. Middleware leaves the path open (a lead's job
  // panel reads it), so the handler keeps it from a caller with no money view:
  // field holds the Jobs page, not its figures (2026-11-21).
  if (!(await holdsAnyView(COST_VIEWS))) return FORBIDDEN();
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
