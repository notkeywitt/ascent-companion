import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { topRibbonJobs } from "@/lib/yearRibbon";
import { readYearRibbon } from "@/lib/yearRibbonRead";

/**
 * Read-only: the Jobs page's year ribbon. Every job with any hours, bills or
 * invoices this year, largest first and none folded into "Other", so a picked
 * job always has its own line.
 * It answers from the same cached read as the Home ribbon.
 *
 * Gated by middleware on the `jobs-hub` view (office, admin, lead), the view
 * that already shows a job's cost.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const { year, today, jobs } = await readYearRibbon();
    return NextResponse.json({ year, today, jobs: topRibbonJobs(jobs, Infinity) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
