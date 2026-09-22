import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// The registered-sender registry — back-end for the "Auto-Ingest Senders" page.
// Every action is a thin pass-through to the Apps Script web app, which owns the
// "Email Senders" sheet (RegisteredSenderBills.js). Access is gated by the
// `email-senders` view in src/lib/views.ts, which lists this path alongside the
// page, so field and lead roles can't read or edit the registry by calling here
// directly.
//
// Actions:
//   resolveEmailLink { gmailLink | threadId | messageId }
//     → { ok, sender, fromHeader, subject, bodySnippet, pdfAttachments:[{index,name}],
//         preview:{ bySource:{ subject:{job,customer}, body, pdf }, total } }
//   listVendors        → { ok, vendors:[{ id, name }] }      (Vendors sheet)
//   listCostCodes      → { ok, costCodes:[{ code, name }] }  (Service sheet CSI)
//   listEmailSenders   → { ok, senders:[…] }
//   saveEmailSender    { senderEmail, subjectPattern, jobSource, vendorId, costCode,
//                        enabled } → { ok, sender }
//   deleteEmailSender  { senderEmail } → { ok }
//   setEmailSenderEnabled { senderEmail, enabled } → { ok, sender }
//
// resolveEmailLink runs a dry-run extraction inline in Apps Script (~15–45s), so
// this route declares a longer budget than the 10s default and passes a matching
// timeout. The effective ceiling still depends on the Vercel plan.
export const maxDuration = 120;

const ALLOWED = new Set([
  "resolveEmailLink",
  "listVendors",
  "listCostCodes",
  "listEmailSenders",
  "saveEmailSender",
  "deleteEmailSender",
  "setEmailSenderEnabled",
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

  // The dry run reads a PDF and calls the model; the rest are quick sheet reads.
  const timeoutMs = action === "resolveEmailLink" ? 110_000 : 25_000;
  return callAppsScriptResponse(body, { timeoutMs });
}
