import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy to the Apps Script web app's Assistant email actions — the back-end for
// the Gmail add-on's "Log Invoice" card, now driven from the assistant. Reuses
// the same web-app deployment + shared secret as /api/jt-sync (the doPost
// action router); the secret stays server-side in env vars.
//
// Env (shared with /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
// POST /api/email { action, ... } forwards the body (secret injected) to Apps
// Script. Supported actions:
//   listProjects            → { ok, projects: [{label,id}] }
//   listEmails { query?, limit? } → { ok, emails: [...] }  (emails carry an
//                             attachments:[{index,name}] list of the PDFs)
//   logInvoice { messageId, projectId, paid? } → { ok, kind, message, ... }
//     OR (multi-invoice email) { messageId, assignments:[{index,projectId,paid?}] }
//       → { ok, kind, finalized, results:[{index,ok,message,...}], message }
//   markProcessed { messageId, projectId, undo?, wasTagged? } → { ok, kind, ... }
//     (bill entered in JT by hand: tag Processed + the job, drop from the list)
//   markNotRelevant { messageId, undo?, wasTagged? } → { ok, kind, ... }
//     (not an invoice: tag "Not an Invoice", drop from the list)
//
// logInvoice runs Gemini inline in Apps Script (~15–45s), so allow a longer
// function timeout than the default (the effective ceiling still depends on the
// Vercel plan — 60s Hobby / up to 300s Pro).
export const maxDuration = 120;

const ALLOWED = new Set([
  "listProjects",
  "listEmails",
  "logInvoice",
  "markProcessed",
  "markNotRelevant",
]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: `Unsupported action: ${action || "(none)"}` }, { status: 400 });
  }

  // logInvoice runs Gemini inline in Apps Script (~15-45s); stay just under this
  // route's maxDuration (120s). listProjects/listEmails retry automatically.
  return callAppsScriptResponse(body, { timeoutMs: 110_000 });
}
