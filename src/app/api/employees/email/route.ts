import { NextRequest, NextResponse } from "next/server";

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

  try {
    // Apps Script answers via a 302 to a one-time content URL, always HTTP 200
    // there — success/failure is the `ok` field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, secret, action: "emailEmployees" }),
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
