import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy to the Apps Script web app's employee actions. Apps Script holds the
// Google Sheets grant (it reads/writes the Project Database "Employee" tab); the
// Assistant has no Sheets client, so it asks over the same shared-secret web app
// used by /api/email and /api/jt-sync. The secret stays server-side; these
// routes are browser-called and sit behind normal Google sign-in.
//
// Env (shared with /api/email, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
//   GET            → { ok, employees:[{name, position, id}] }   (Active only — the
//                    /safety-meeting attendee dropdown)
//   GET ?full=1    → { ok, employees:[{id, ...fields}], statuses:[] }  (the /employees
//                    management page — everyone, every field)
//   PATCH { id, fields } → { ok, employee, changed }             (edit one employee)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const full = req.nextUrl.searchParams.get("full");
  return callAppsScriptResponse({ action: full ? "listEmployeesFull" : "listEmployees" });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  return callAppsScriptResponse({ ...body, action: "updateEmployee" });
}
