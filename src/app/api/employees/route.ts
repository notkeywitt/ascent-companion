import { NextRequest, NextResponse } from "next/server";

// Proxy to the Apps Script web app's employee actions. Apps Script holds the
// Google Sheets grant (it reads/writes the Project Database "Employee" tab); the
// Companion has no Sheets client, so it asks over the same shared-secret web app
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

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
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
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) {
  const full = req.nextUrl.searchParams.get("full");
  return callAppsScript({ action: full ? "listEmployeesFull" : "listEmployees" });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  return callAppsScript({ ...body, action: "updateEmployee" });
}
