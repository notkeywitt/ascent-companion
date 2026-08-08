import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy to the Apps Script web app's `emailEmployees` action — the back-end for
// the /employees page's "Email employees" composer. Apps Script holds the Gmail
// grant and sends the message FROM office@ascentbuildingco.com; the Assistant
// has no mail client, so it forwards over the same shared-secret web app used by
// /api/employees and /api/email. The secret stays server-side.
//
// This route is listed under the "employees" view in lib/views.ts, so the
// middleware gates it to office/admin exactly like the page — a field user can
// neither see the composer nor POST here directly. (Plain /api/employees stays
// ungated because /safety-meeting, a field view, reads its Active roster.)
//
// Env (shared with /api/employees, /api/email, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
//   POST { ids:[employeeId...], subject, body, dryRun? }
//     → { ok, sent, recipients:[{id,name,email}], skipped:[{id,name,reason}] }
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Sends real mail — a write, so never retried.
  return callAppsScriptResponse({ ...body, action: "emailEmployees" });
}
