import { NextRequest, NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { readYearRibbon } from "@/lib/yearRibbonRead";

/**
 * Read-only: one job's year ribbon for the Jobs page. `?jobId=` picks the job.
 * It answers from the same cached read as the Home ribbon.
 *
 * Gated by middleware on the `jobs-hub` view (office, admin, lead), the view
 * that already shows a job's cost.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = req.nextUrl.searchParams.get("jobId") ?? "";
  if (!jobId) return NextResponse.json({ error: "A job is required." }, { status: 400 });
  try {
    const { year, today, jobs } = await readYearRibbon();
    const job = jobs.find((j) => j.id === jobId);
    return NextResponse.json({ year, today, jobs: job ? [job] : [] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
