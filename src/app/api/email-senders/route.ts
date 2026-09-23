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
//   previewSenderEmail { senderEmail | messageId | threadId }
//     → { ok, sender, fromHeader, subject, bodySnippet, pdfAttachments:[{index,name}],
//         preview:{ bySource:{ subject:{job,customer}, body, pdf }, total } }
//     Finds that sender's newest bill email (attachment-carrying first) and dry-runs
//     it. A pasted Gmail URL can't be used: the "#all/FMfcgz…" id in a Gmail web URL
//     is a permalink id, which no Gmail API call accepts.
//   emailSendersBootstrap → { ok, vendors, costCodes, senders }
//     The page's whole load in ONE call. Apps Script runs one execution at a time
//     per user, so three separate reads queue rather than overlap — and the last
//     one timed out at 25s waiting behind the others' cold starts.
//   listVendors        → { ok, vendors:[{ id, name }] }      (Vendors sheet)
//   listCostCodes      → { ok, costCodes:[{ code, name }] }  (Service sheet CSI)
//   listEmailSenders   → { ok, senders:[…] }
//   saveEmailSender    { senderEmail, subjectPattern, jobSource, vendorId, costCode,
//                        enabled } → { ok, sender }
//   deleteEmailSender  { senderEmail } → { ok }
//   setEmailSenderEnabled { senderEmail, enabled } → { ok, sender }
//
// previewSenderEmail runs a dry-run extraction inline in Apps Script (~15–45s), so
// this route declares a longer budget than the 10s default and passes a matching
// timeout. The effective ceiling still depends on the Vercel plan.
export const maxDuration = 120;

const ALLOWED = new Set([
  "previewSenderEmail",
  "emailSendersBootstrap",
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

  // The dry run searches Gmail, reads a PDF and calls the model. The bootstrap is
  // three sheet reads plus a possible cold start, which 25s did not cover. The
  // rest are single quick reads or a one-row write.
  const timeoutMs =
    action === "previewSenderEmail" ? 110_000 : action === "emailSendersBootstrap" ? 60_000 : 25_000;
  return callAppsScriptResponse(body, { timeoutMs });
}
