import { NextRequest, NextResponse } from "next/server";

import { authorizeAgent } from "@/lib/agentToken";
import { beginRun, createFile, dueNow, failRun, saveChunk, submitResult } from "@/lib/leadResearch";

/**
 * /api/invoice-review/agent/research — lead research's door for Claude Code on
 * a Mac (skill /lead-research, scripts/lead-research/agent.mjs).
 *
 * It sits under /api/invoice-review/agent so it shares that door's bearer
 * token (REVIEW_AGENT_TOKEN, lib/agentToken.ts) and its public entry in
 * src/middleware.ts. The token is the only gate.
 *
 * GET  ?action=due                     is a run waiting
 * POST { action: "begin", runner }     claim the oldest waiting run (null: none)
 * POST { action: "submit", runId, result }   the dossier; the run becomes ready
 * POST { action: "file", runId, name, kind, mime, size, source, description }
 *                                      register one file → { fileId, chunks }
 * PUT  ?fileId=…&seq=N  (raw bytes)    one chunk of that file
 * POST { action: "fail", runId, message }
 *
 * WRITES only the companion's lead_research tables. Nothing here touches
 * JobTread: a person approves the dossier on /leads/research/<id>.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const text = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const fail = (e: unknown, status = 422) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  if (req.nextUrl.searchParams.get("action") === "due") return NextResponse.json({ ok: true, ...(await dueNow()) });
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
  try {
    switch (body.action) {
      case "begin":
        return NextResponse.json({ ok: true, run: await beginRun(text(body.runner, 120) || "a Mac") });
      case "submit":
        return NextResponse.json({ ok: true, ...(await submitResult(text(body.runId, 64), body.result)) });
      case "file":
        return NextResponse.json({
          ok: true,
          ...(await createFile(text(body.runId, 64), {
            name: text(body.name, 200),
            kind: text(body.kind, 20),
            mime: text(body.mime, 100),
            size: Number(body.size),
            source: text(body.source, 1000),
            description: text(body.description, 1000),
          })),
        });
      case "fail":
        await failRun(text(body.runId, 64), text(body.message));
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  const fileId = text(req.nextUrl.searchParams.get("fileId"), 64);
  const seq = Number(req.nextUrl.searchParams.get("seq"));
  try {
    await saveChunk(fileId, seq, Buffer.from(await req.arrayBuffer()));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
