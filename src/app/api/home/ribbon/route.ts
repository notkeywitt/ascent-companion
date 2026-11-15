import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { topRibbonJobs } from "@/lib/yearRibbon";
import { readYearRibbon } from "@/lib/yearRibbonRead";

/**
 * Read-only: the Home ribbon. The current year, per ISO week: crew hours per
 * work day and vendor bill cost, for the largest jobs plus an "Other" rollup.
 *
 * Gated by middleware on the `home` view (office + admin), like every
 * /api/home read: it carries every job's vendor cost.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const { year, today, jobs } = await readYearRibbon();
    return NextResponse.json({ year, today, jobs: topRibbonJobs(jobs) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
