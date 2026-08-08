import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches } from "@/lib/jobtread";
import { callAppsScript } from "@/lib/appsScript";

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

  // Not callAppsScriptResponse: the cache clear below has to happen between the
  // call and the reply. Delete+recreate is a write, so this is never retried.
  const res = await callAppsScript({ action: "reassignJob", docId, jobId }, { timeoutMs: 110_000 });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  // The bill was delete+recreated on another job, so both jobs' cached
  // budget/cost-to-complete are stale.
  clearJobCostCaches();
  return NextResponse.json(res.data, { status: 200 });
}
