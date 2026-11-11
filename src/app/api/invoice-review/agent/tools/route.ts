import { NextRequest, NextResponse } from "next/server";

import { authorizeAgent } from "@/lib/agentToken";
import { addTool, beginRun, dueNow, endRun, readPhoto, skipItem } from "@/lib/toolBatch";
import { cleanFields } from "@/lib/toolBatchRules";

/**
 * /api/invoice-review/agent/tools — batch add's door for Claude Code on the
 * office Mac (skill /tool-batch, scripts/tool-batch/agent.mjs).
 *
 * It sits under /api/invoice-review/agent so it shares that door's bearer
 * token (REVIEW_AGENT_TOKEN, lib/agentToken.ts) and its public entry in
 * src/middleware.ts. The token is the only gate; there is no session fallback.
 *
 * GET  ?action=due            is a run due (the Analyze button, or the quiet timer)
 * GET  ?action=photo&id=…     one photo's bytes
 * POST { action: "begin" }    hand every ready tool to this run, with photo ids
 *                             and the Tools list's own types, groups and names
 * POST { action: "add", itemId, fields, note? }   register one tool on the
 *                             Tools list (Apps Script createTool + its photo)
 * POST { action: "skip", itemId, reason }         park one tool for the office
 * POST { action: "finish", message? } | { action: "fail", message }
 *
 * WRITES. The companion's batch tables, and — on "add" only — one new row and
 * photo on the Tools list, the same writes as the Tools page's "Add tool".
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
    case "begin":
      return NextResponse.json({ ok: true, ...(await beginRun(WHO)) });
    case "add": {
      const fields = cleanFields(body.fields);
      if (!fields) return NextResponse.json({ error: "fields.name is required." }, { status: 400 });
      const r = await addTool(text(body.itemId, 64), fields, text(body.note, 1000));
      return NextResponse.json(r, { status: r.ok ? 200 : 422 });
    }
    case "skip":
      await skipItem(text(body.itemId, 64), text(body.reason, 1000));
      return NextResponse.json({ ok: true });
    case "finish":
    case "fail": {
      const returned = await endRun(body.action === "finish" ? "done" : "error", text(body.message), WHO);
      return NextResponse.json({ ok: true, returned });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
