import { NextRequest, NextResponse } from "next/server";
import { searchBills, getIndexStatus } from "@/lib/billSearch";

/**
 * The bill search endpoint — serves the /bill-search page from the local index.
 *
 *   GET /api/bill-search            → { status }              (index health only)
 *   GET /api/bill-search?q=2x4      → { results, status }     (ranked hits)
 *
 * `status.stale` tells the client the live (JobTread) half of the index is older
 * than the freshness window; the page reacts by POSTing to /refresh in the
 * background and re-querying when it finishes. Search itself always answers from
 * whatever is already indexed, so it stays fast regardless.
 *
 * Read-only. Gated to the `bill-search` view by middleware (see lib/views.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  try {
    const status = await getIndexStatus();
    if (!q) return NextResponse.json({ status }, { status: 200 });
    const results = await searchBills(q);
    return NextResponse.json({ results, status }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed" },
      { status: 500 },
    );
  }
}
