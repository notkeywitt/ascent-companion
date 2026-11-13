import { NextResponse } from "next/server";

import { loadAttention } from "@/lib/homeAttention";

/**
 * GET /api/attention → { rows } — the reader's waiting queues, one row each.
 * Home's "Needs attention" count and TodayQueue read it. On no view's `paths`
 * on purpose: every role may call it, and lib/homeAttention gates each queue
 * by its own view.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json({ rows: await loadAttention() });
}
