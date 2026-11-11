import { NextResponse } from "next/server";

import { requestAnalysis } from "@/lib/toolBatch";
import { toolBatchUser } from "@/lib/toolBatchAccess";

/**
 * POST /api/tools/batch/analyze — the "Analyze Tools Batch" button. It logs a
 * request; the office Mac (scripts/tool-batch/run.sh, every 10 minutes) sees it
 * and starts Claude Code on /tool-batch. Gated by the `tools-batch-analyze`
 * view in middleware, and again here.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await toolBatchUser();
  if (!user.canAnalyze) return NextResponse.json({ error: "Office only." }, { status: 403 });
  await requestAnalysis(user.email);
  return NextResponse.json({ ok: true });
}
