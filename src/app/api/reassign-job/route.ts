import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches } from "@/lib/jobtread";

// Proxy the Assistant's "move this bill to another job" action to the Apps Script
// doPost router (action "reassignJob"). JobTread can't move a bill between jobs,
// so Apps Script delete+recreates it on the new job via its reassignment guard,
// keeping the Expenditure sheet + Drive tree in sync. The delete+recreate + PDF
// re-attach runs inline, so allow a longer function timeout than the default
// (the effective ceiling still depends on the Vercel plan).
//
// Env (shared with /api/email, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
// POST /api/reassign-job { docId, jobId } →
//   { ok, newDocId, jobId, projectId, expId } | { ok:false, error } | { error }
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const docId = String(body.docId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  if (!docId || !jobId) {
    return NextResponse.json({ error: "docId and jobId are required." }, { status: 400 });
  }

  try {
    // Apps Script web apps answer via a 302 to a one-time content URL and always
    // report HTTP 200 there — success/failure is the "ok" field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reassignJob", docId, jobId, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
    // The bill was delete+recreated on another job, so both jobs' cached
    // budget/cost-to-complete are stale.
    clearJobCostCaches();
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
