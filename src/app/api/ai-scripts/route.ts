import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { cancelRunNow, dashboard, requestRunNow, requestStop, runDetail, saveSettings } from "@/lib/agentRuns";
import { cleanRunArg, cleanSettings, scriptById } from "@/lib/agentScripts";

/**
 * The AI Scripts page's route (/ai-scripts). Gated by the "ai-scripts" view
 * (admin by default).
 *
 * GET               every script, its settings and last run; runs in progress
 *                   with their latest steps; recent runs; the Macs
 * GET ?run=…        one run with all its steps
 * POST { action: "settings", scriptId, model?, paused?, extraPrompt?, maxTurns? }
 * POST { action: "run", scriptId, arg? }      a Mac starts it on its next check
 * POST { action: "cancel-run", scriptId }     withdraw a Run now no Mac took yet
 * POST { action: "stop", runId }              the Mac stops it on its next report
 *
 * Writes only the companion's agent_* tables. Calls no Claude.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const run = req.nextUrl.searchParams.get("run");
  if (run) {
    const r = await runDetail(run);
    return r ? NextResponse.json({ run: r }) : NextResponse.json({ error: "No such run." }, { status: 404 });
  }
  return NextResponse.json(await dashboard());
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const who = (await auth())?.user?.email ?? "";
  if (body.action === "stop") {
    const ok = await requestStop(String(body.runId ?? ""), who);
    return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "That run is not running." }, { status: 409 });
  }
  const script = scriptById(String(body.scriptId ?? ""));
  if (!script) return NextResponse.json({ error: "Unknown script." }, { status: 404 });
  switch (body.action) {
    case "settings": {
      const c = cleanSettings(body);
      if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });
      return NextResponse.json({ settings: await saveSettings(script.id, c.ok, who) });
    }
    case "run": {
      if (script.trigger === "hand") return NextResponse.json({ error: `${script.name} runs by hand only.` }, { status: 400 });
      const a = cleanRunArg(script, body.arg);
      if ("error" in a) return NextResponse.json({ error: a.error }, { status: 400 });
      await requestRunNow(script.id, a.ok, who);
      return NextResponse.json({ ok: true });
    }
    case "cancel-run":
      await cancelRunNow(script.id);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
