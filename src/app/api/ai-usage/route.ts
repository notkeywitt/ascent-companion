import { NextResponse } from "next/server";

import { readUsageByMonth } from "@/lib/aiUsage";

/**
 * GET /api/ai-usage — what Claude has cost, by month and feature, last 12 months.
 * Read-only. Gated by the "ai-cost" view (admin by default), which lists this
 * route in its paths.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await readUsageByMonth(12);
  return NextResponse.json({ rows });
}
