import { NextRequest, NextResponse } from "next/server";

// Proxy to the Apps Script web app's task registry — the back-end for the
// Companion's Actions page. Reuses the same web-app deployment + shared secret
// as /api/jt-sync and /api/email (the doPost action router); the secret stays
// server-side in env vars.
//
// Env (shared with /api/jt-sync, /api/email, /api/tool-tracker):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
//   GET            → { ok, tasks:[{key,label,group,description,lock}] }
//                    (the buttons; page renders straight from this list)
//   POST { task }  → runs that task INLINE in Apps Script and returns
//                    { ok, task, label, note, seconds } — or, when a sync holds
//                    the shared lock, { ok, lockBusy:true, note } (nothing ran).
//
// Tasks run inline (the caller waits for the whole run), so results — including
// counts — come straight back. Most finish in seconds; the Sunset scan can take
// a couple of minutes on a backlog, hence the long function timeout (Vercel Pro
// allows up to 300s). A run that outlives the HTTP timeout still completes in
// Apps Script and is recorded in the Audit Log (visible on /logs).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    // Apps Script answers via a 302 to a one-time content URL, always HTTP 200
    // there — success/failure is the `ok` field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as unknown, status: 200 };
    } catch {
      return {
        error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        status: 502,
      };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error", status: 502 };
  }
}

export async function GET() {
  const r = await callAppsScript({ action: "listTasks" });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!task) return NextResponse.json({ error: "task is required." }, { status: 400 });

  const r = await callAppsScript({ action: "runTask", task });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
