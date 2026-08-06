import { NextRequest, NextResponse } from "next/server";
import { getJobCostContributors } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: the individual vendor-bill lines and time entries behind every
 * cost code's "bills"/"labor" total on the given job — what the Invoicing
 * board's cost-code rail drills into on a click. Separate from /api/recode
 * (which the board fetches unconditionally on load) since most sessions never
 * click a code; this only runs when one is.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });

  try {
    const cfg = getPaveConfig();
    const contributors = await getJobCostContributors(cfg, jobId);
    return NextResponse.json(contributors);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
