import { NextRequest, NextResponse } from "next/server";

import {
  batchSummary,
  cancelCapture,
  discardItem,
  finishCapture,
  queueUpdates,
  retryItem,
  saveItem,
  setLocation,
} from "@/lib/toolBatch";
import { toolBatchUser } from "@/lib/toolBatchAccess";

/**
 * /api/tools/batch — the phone side of batch add (lib/toolBatch.ts).
 *
 * GET  → the batch card: counts by status, the waiting tools, problems,
 *        recently done, the analysis log, whether a run is due, `canAnalyze`.
 * POST { action: "item", id, toolId, idSource, mode, location }  a tool was started
 *        (mode "update" = a QR already on the Tools list)
 * POST { action: "location", ids, location }     the GPS job site, once it arrived
 * POST { action: "done", id }                    its photos are all sent
 * POST { action: "cancel", id }                  closed before any photo: drop it
 * POST { action: "update", toolIds }             "Ask Claude" on tools already listed
 * POST { action: "retry" | "discard", id }       office: clear a problem or a waiting tool
 *
 * Every role may capture (the `tools` view). Retry and discard need the
 * `tools-batch-analyze` view, checked here. Writes only companion tables.
 */
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const str = (v: unknown, max = 100) => String(v ?? "").trim().slice(0, max);

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
  const user = await toolBatchUser();

  if (body.action === "update") {
    const toolIds = (Array.isArray(body.toolIds) ? body.toolIds : []).map((t) => str(t)).filter(Boolean).slice(0, 200);
    if (!toolIds.length) return NextResponse.json({ error: "toolIds is required." }, { status: 400 });
    return NextResponse.json({ ok: true, queued: await queueUpdates(toolIds, user.email) });
  }
  if (body.action === "location") {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map((t) => str(t, 64)).filter((t) => ID_RE.test(t));
    await setLocation(ids, str(body.location));
    return NextResponse.json({ ok: true });
  }

  const id = String(body.id ?? "");
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Bad item id." }, { status: 400 });
  switch (body.action) {
    case "item": {
      const toolId = str(body.toolId);
      if (!toolId) return NextResponse.json({ error: "toolId is required." }, { status: 400 });
      await saveItem({
        id,
        toolId,
        idSource: str(body.idSource) || "qr",
        mode: str(body.mode) || "add",
        location: str(body.location),
        by: user.email,
      });
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
