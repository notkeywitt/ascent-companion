import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy the Needs-Project review queue to the Apps Script doPost router. These are
// ingested bills held for a JOB decision (Status "Needs Review", no Project ID,
// not yet in JobTread) — ingestion refuses to guess when a Sunset "Sold-To" names
// a customer with more than one job. The queue lists them (GET → listNeedsProject)
// and assigns one to a job + pushes it (POST → resolveNeedsProject). The push +
// PDF re-attach runs inline, so allow a longer timeout than the default.
//
// Env (shared with /api/email, /api/reassign-job, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
export const maxDuration = 120;

// GET /api/needs-project → { ok, items: [{ expId, vendor, amount, date, driveUrl }] }
export async function GET() {
  return callAppsScriptResponse({ action: "listNeedsProject" });
}

// POST /api/needs-project
//   { expId, jobId }        → resolveNeedsProject → { ok, docId, jobId, projectId }
//   { expId, dismiss:true } → dismissNeedsProject → { ok, expId }
//     (already handled/duplicate/not a bill: stamps Status="Dismissed" so it
//      leaves the queue; the sheet row + Drive PDF are kept.)
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const expId = String(body.expId ?? "").trim();
  if (!expId) {
    return NextResponse.json({ error: "expId is required." }, { status: 400 });
  }
  if (body.dismiss === true) {
    return callAppsScriptResponse({ action: "dismissNeedsProject", expId });
  }
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }
  return callAppsScriptResponse({ action: "resolveNeedsProject", expId, jobId });
}
