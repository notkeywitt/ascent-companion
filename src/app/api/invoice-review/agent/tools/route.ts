import { NextRequest, NextResponse } from "next/server";

import { authorizeAgent } from "@/lib/agentToken";
import { applyResult, beginRun, dueNow, endRun, readPhoto, readToolPhoto, skipItem } from "@/lib/toolBatch";
import { cleanFields } from "@/lib/toolBatchRules";

/**
 * /api/invoice-review/agent/tools — batch add's door for Claude Code: on the
 * office Mac, or in a session started from the Tools page's copied prompt
 * (skill /tool-batch, scripts/tool-batch/agent.mjs).
 *
 * It sits under /api/invoice-review/agent so it shares that door's bearer
 * token (REVIEW_AGENT_TOKEN, lib/agentToken.ts) and its public entry in
 * src/middleware.ts. The token is the only gate; there is no session fallback.
 *
 * GET  ?action=due            is a run due (the Analyze button, or the quiet timer)
 * GET  ?action=photo&id=…     one batch photo's bytes
 * GET  ?action=toolphoto&toolId=…   a listed tool's current Drive photo (update mode)
 * POST { action: "begin", ids? }    hand the ready tools (or only `ids`) to a new
 *                             run: its runId, photo ids, each update tool's
 *                             current fields, and the list's types, groups, names
 * POST { action: "add", itemId, fields, note? }   write one tool to the Tools
 *                             list: createTool (+ photo), or updateTool in update mode
 * POST { action: "skip", itemId, reason }         park one tool for the office
 * POST { action: "finish", runId, message? } | { action: "fail", runId, message }
 *
 * WRITES. The companion's batch tables, and — on "add" only — one Tools-list
 * row: a new tool and its photo (as the page's "Add tool"), or, in update
 * mode, the fields Claude filled (as the page's Edit → Save).
 * Nothing here touches JobTread.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WHO = "claude-code";
const text = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

export async function GET(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  const action = req.nextUrl.searchParams.get("action") ?? "";
  if (action === "due") return NextResponse.json({ ok: true, ...(await dueNow()) });
  if (action === "photo") {
    const p = await readPhoto(req.nextUrl.searchParams.get("id") ?? "");
    if (!p) return NextResponse.json({ error: "No such photo." }, { status: 404 });
    return new NextResponse(new Uint8Array(p.bytes), { status: 200, headers: { "content-type": p.mime } });
  }
  if (action === "toolphoto") {
    const p = await readToolPhoto(req.nextUrl.searchParams.get("toolId") ?? "");
    if (!p) return NextResponse.json({ error: "No Drive photo could be read for this tool." }, { status: 404 });
    return new NextResponse(new Uint8Array(p.bytes), { status: 200, headers: { "content-type": p.mime } });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  switch (body.action) {
    case "begin": {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => text(x, 64)).filter(Boolean);
      return NextResponse.json({ ok: true, ...(await beginRun(WHO, ids)) });
    }
    case "add": {
      const fields = cleanFields(body.fields);
      if (!fields) return NextResponse.json({ error: "fields is empty." }, { status: 400 });
      const r = await applyResult(text(body.itemId, 64), fields, text(body.note, 1000), WHO);
      return NextResponse.json(r, { status: r.ok ? 200 : 422 });
    }
    case "skip":
      await skipItem(text(body.itemId, 64), text(body.reason, 1000));
      return NextResponse.json({ ok: true });
    case "finish":
    case "fail": {
      const returned = await endRun(body.action === "finish" ? "done" : "error", text(body.message), WHO, text(body.runId, 64));
      return NextResponse.json({ ok: true, returned });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
