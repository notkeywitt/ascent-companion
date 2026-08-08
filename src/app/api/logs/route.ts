import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy the System_Logs audit tab to the Apps Script doPost router. This is the
// ~2,000-row rolling log that writeAuditLog appends to (the push/sync engine,
// ingestion, diagnostics). Read-only: GET → listSystemLogs, newest-first, with
// optional ?limit / ?level / ?query filters forwarded to the Apps Script action.
//
// Env (shared with /api/needs-project, /api/email, /api/reassign-job, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
export const maxDuration = 120;

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
  return callAppsScriptResponse(payload);
}
