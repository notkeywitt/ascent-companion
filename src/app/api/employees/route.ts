import { NextRequest, NextResponse } from "next/server";
import { callAppsScript, callAppsScriptResponse } from "@/lib/appsScript";
import { FORBIDDEN, holdsView } from "@/lib/apiAuth";
import { clearJtUserLink } from "@/lib/jtUserLink";

// Proxy to the Apps Script web app's employee actions. Apps Script holds the
// Google Sheets grant (it reads/writes the Project Database "Employee" tab); the
// Assistant has no Sheets client, so it asks over the same shared-secret web app
// used by /api/email and /api/jt-sync. The secret stays server-side.
//
// ## Two audiences, one route — which is why the gate is here and not in views.ts
//
// This route cannot ride a single middleware prefix gate. The ROSTER read is
// needed by /safety-meeting and /mileage-tracker, both FIELD views, so it has to
// stay open to every signed-in role. The FULL read and the edit are a different
// thing entirely: the Employee tab holds home address, birthday, driver's
// licence number and personal phone, and PATCH rewrites any of them.
//
// Until 2026-09-14 the whole route was ungated, so any signed-in account — a
// crew member's phone included — could read every employee's address, birthday
// and licence number, and edit them. That was finding C-1 of the September 2026
// security review. The split below is the fix: the roster stays open, and
// everything that carries personal data needs the `employees` view (office +
// admin by default, or a per-user grant from the admin console).
//
// Env (shared with /api/email, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
//   GET                  → { ok, employees:[{name, position, id}] }   OPEN.
//                          Active only, three fields, no personal data — the
//                          /safety-meeting attendee dropdown and the
//                          /mileage-tracker name resolver.
//   GET ?full=1          → { ok, employees:[{id, ...every field}], statuses:[] }
//                          GATED on `employees` — the /employees management page.
//   PATCH { id, fields } → { ok, employee, changed }
//                          GATED on `employees` — edit one employee.
//   POST { fields }      → { ok, employee }
//                          GATED on `employees` — add one employee. Apps Script
//                          mints the Employee ID and refuses a duplicate email.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // The roster: Active employees, name/position/id only (_smtgActiveEmployees in
  // the appscript repo). Deliberately open — a field lead running a safety
  // meeting must be able to pick attendees.
  if (!req.nextUrl.searchParams.get("full")) {
    return callAppsScriptResponse({ action: "listEmployees" });
  }
  // Every field of every employee, personal data included.
  if (!(await holdsView("employees"))) return FORBIDDEN();
  return callAppsScriptResponse({ action: "listEmployeesFull" });
}

export async function PATCH(req: NextRequest) {
  if (!(await holdsView("employees"))) return FORBIDDEN();
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  // `action` is set LAST so a caller cannot supply their own and route this
  // request at a different Apps Script handler.
  return callAppsScriptResponse({ ...body, action: "updateEmployee" });
}

export async function POST(req: NextRequest) {
  if (!(await holdsView("employees"))) return FORBIDDEN();
  const body = await req.json().catch(() => null);
  if (!body?.fields || typeof body.fields !== "object") {
    return NextResponse.json({ error: "Body must carry a fields object." }, { status: 400 });
  }
  const r = await callAppsScript<{ ok?: boolean; error?: string }>({
    fields: body.fields,
    action: "addEmployee",
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  // A person who signed in before they had a roster row may hold a cached
  // "nobody" link for up to a day. Drop it so their next load finds the new row.
  const email = String(body.fields.email ?? "");
  if (r.data?.ok !== false && email) await clearJtUserLink(email);
  return NextResponse.json(r.data);
}
