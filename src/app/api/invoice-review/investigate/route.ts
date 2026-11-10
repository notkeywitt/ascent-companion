import { NextRequest, NextResponse } from "next/server";

import { readDispositions } from "@/lib/invoiceReview/dispositions";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { readInvestigation, recentMonthlyCheckRuns } from "@/lib/invoiceReview/investigations";

/**
 * GET /api/invoice-review/investigate?ym=YYYY-MM — the month's investigation
 * pass: its status line, the verdicts on file, the full report, and the
 * scheduled runs' recent outcomes (start, done, error with its log tail).
 *
 * The pass itself is no longer run here. Claude Code on the office Mac runs it
 * on review days (`/monthly-check` skill, scheduled by
 * scripts/monthly-check/) and posts its verdicts through
 * /api/invoice-review/agent. This route only lets the page read them.
 *
 * A verdict is NOT a ruling: it changes no number, hides no finding, and moves
 * no severity. Only the office can silence a finding, through a ruling.
 *
 * Gated by the `invoice-review` view in middleware, the same as the review.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const parsed = parseYm((req.nextUrl.searchParams.get("ym") ?? "").trim());
  if (!parsed) {
    return NextResponse.json({ error: "Pass ym=YYYY-MM (the billing month)." }, { status: 400 });
  }
  const ym = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;

  const [investigation, byKey, runs] = await Promise.all([
    readInvestigation(ym),
    readDispositions(ym),
    recentMonthlyCheckRuns(ym),
  ]);
  const dispositions = [...byKey.entries()].map(([key, d]) => ({
    key,
    verdict: d.verdict,
    why: d.why,
    suggestedAction: d.suggestedAction,
    model: d.model,
    at: d.at,
  }));
  return NextResponse.json({ ym, investigation, dispositions, runs });
}
