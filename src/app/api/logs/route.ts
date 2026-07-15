import { NextRequest, NextResponse } from "next/server";

// Proxy the System_Logs audit tab to the Apps Script doPost router. This is the
// ~2,000-row rolling log that writeAuditLog appends to (the push/sync engine,
// ingestion, diagnostics). Read-only: GET → listSystemLogs, newest-first, with
// optional ?limit / ?level / ?query filters forwarded to the Apps Script action.
//
// Env (shared with /api/needs-project, /api/email, /api/reassign-job, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
export const maxDuration = 120;

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
    // Apps Script web apps answer via a 302 to a one-time content URL and always
    // report HTTP 200 there — success/failure is the "ok" field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: 200 });
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

// GET /api/logs?limit=&level=&query=
//   → { ok, items: [{ timestamp, level, expId, action, details, status }] }
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const payload: Record<string, unknown> = { action: "listSystemLogs" };
  const limit = sp.get("limit");
  const level = sp.get("level");
  const query = sp.get("query");
  if (limit) payload.limit = Number(limit);
  if (level) payload.level = level;
  if (query) payload.query = query;
  return callAppsScript(payload);
}
