import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getMonthCostByJob } from "@/lib/monthCostByJob";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Two org-wide walks (the month's bill lines and time entries).
export const maxDuration = 60;

const cached = unstable_cache(
  (year: number, month: number) => getMonthCostByJob(getPaveConfig(), year, month),
  ["trackingsheet-month-donuts"],
  { revalidate: 300, tags: ["jt-bills"] },
);

/**
 * Read-only: every job's cost by cost code for one billing month — the ring
 * cards on Tracking Sheets with no job selected. Gated by the `recode` view's
 * `/api/trackingsheet` prefix.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const year = Number(p.get("year"));
  const month = Number(p.get("month"));
  if (!year || !(month >= 1 && month <= 12)) {
    return NextResponse.json({ error: "year and month are required." }, { status: 400 });
  }
  try {
    return NextResponse.json({ jobs: await cached(year, month) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
