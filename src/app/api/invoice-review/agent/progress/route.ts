import { NextRequest, NextResponse } from "next/server";

import { authorizeAgent } from "@/lib/agentToken";
import { addEvents, check, endRun, reportCode, startRun, type EventIn } from "@/lib/agentRuns";
import { scriptById } from "@/lib/agentScripts";

/**
 * /api/invoice-review/agent/progress — every Mac script's door for its
 * settings and progress (scripts/agent-progress/agent-run.mjs). Shares the
 * agent door's bearer token (REVIEW_AGENT_TOKEN) and its public entry in
 * src/middleware.ts. The token is the only gate.
 *
 * GET  ?action=check&script=…&machine=…   heartbeat → { state: paused|now|idle, arg }
 * GET  ?action=code&machine=…&version=…&note=…   the Mac's updater: its commit
 * POST { action: "start", script, machine, title? } → { runId, model, extraPrompt, maxTurns }
 * POST { action: "events", runId, events: [{ at, kind, text }] } → { stop }
 * POST { action: "end", runId, status, costUsd, inputTokens, outputTokens, … }
 *
 * WRITES only the companion's agent_* tables and ai_usage.
 */
export const dynamic = "force-dynamic";

const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function GET(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if (q.get("action") === "code") {
    const version = text(q.get("version"), 40);
    if (!/^[0-9a-f]{7,40}$/.test(version)) return NextResponse.json({ error: "version must be a commit id." }, { status: 400 });
    await reportCode(text(q.get("machine"), 120) || "a Mac", version, text(q.get("note"), 300));
    return NextResponse.json({ ok: true });
  }
  if (q.get("action") !== "check") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const script = text(q.get("script"), 60);
  if (!scriptById(script)) return NextResponse.json({ error: "Unknown script." }, { status: 404 });
  return NextResponse.json({ ok: true, ...(await check(script, text(q.get("machine"), 120) || "a Mac")) });
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
    case "start": {
      const script = text(body.script, 60);
      if (!scriptById(script)) return NextResponse.json({ error: "Unknown script." }, { status: 404 });
      return NextResponse.json({ ok: true, ...(await startRun(script, text(body.machine, 120) || "a Mac", text(body.title))) });
    }
    case "events":
      return NextResponse.json({
        ok: true,
        ...(await addEvents(text(body.runId, 64), Array.isArray(body.events) ? (body.events as EventIn[]) : [])),
      });
    case "end":
      await endRun(text(body.runId, 64), {
        status: text(body.status, 20) as "done" | "error" | "stopped",
        costUsd: typeof body.costUsd === "number" ? body.costUsd : null,
        inputTokens: num(body.inputTokens),
        outputTokens: num(body.outputTokens),
        cacheWriteTokens: num(body.cacheWriteTokens),
        cacheReadTokens: num(body.cacheReadTokens),
        result: text(body.result, 2000),
      });
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
