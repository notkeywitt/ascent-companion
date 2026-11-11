import { NextRequest, NextResponse } from "next/server";

import { batchSummary, cancelCapture, discardItem, finishCapture, retryItem, saveItem } from "@/lib/toolBatch";
import { toolBatchUser } from "@/lib/toolBatchAccess";

/**
 * /api/tools/batch — the phone side of batch add (lib/toolBatch.ts).
 *
 * GET  → the batch card: counts by status, problems, recently added, the
 *        analysis log, whether a run is due, and `canAnalyze`.
 * POST { action: "item", id, toolId, idSource }  a tool was started (QR read or skipped)
 * POST { action: "done", id }                    its photos are all sent
 * POST { action: "cancel", id }                  closed before any photo: drop it
 * POST { action: "retry" | "discard", id }       office: clear a problem
 *
 * Every role may capture (the `tools` view). Retry and discard need the
 * `tools-batch-analyze` view, checked here. Writes only companion tables.
 */
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export async function GET() {
  try {
    const [user, summary] = await Promise.all([toolBatchUser(), batchSummary()]);
    return NextResponse.json({ ok: true, canAnalyze: user.canAnalyze, ...summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the batch." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Bad item id." }, { status: 400 });
  const user = await toolBatchUser();

  switch (body.action) {
    case "item": {
      const toolId = String(body.toolId ?? "").trim().slice(0, 100);
      if (!toolId) return NextResponse.json({ error: "toolId is required." }, { status: 400 });
      await saveItem({ id, toolId, idSource: String(body.idSource ?? "qr"), by: user.email });
      return NextResponse.json({ ok: true });
    }
    case "done":
      await finishCapture(id);
      return NextResponse.json({ ok: true });
    case "cancel":
      await cancelCapture(id);
      return NextResponse.json({ ok: true });
    case "retry":
    case "discard":
      if (!user.canAnalyze) return NextResponse.json({ error: "Office only." }, { status: 403 });
      await (body.action === "retry" ? retryItem(id) : discardItem(id));
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
