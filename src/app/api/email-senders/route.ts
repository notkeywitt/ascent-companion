import { NextRequest, NextResponse } from "next/server";

// Proxy to the Apps Script web app's registered-sender registry actions — the
// back-end for the "Auto-Ingest Senders" page. Reuses the SAME web-app deployment
// + shared secret as /api/email and /api/jt-sync (the doPost action router); the
// secret stays server-side in env vars.
//
// Env (shared with /api/email, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
// POST /api/email-senders { action, ... } forwards the body (secret injected) to
// Apps Script. Supported actions:
//   resolveEmailLink { gmailLink | threadId | messageId }
//     → { ok, sender, subject, bodySnippet, pdfAttachments:[{index,name}],
//         preview:{ bySource:{ subject:{job,customer}, body, pdf }, total } }
//   listVendors        → { ok, vendors:[{ id, name }] }        (Vendors sheet)
//   listCostCodes      → { ok, costCodes:[{ code, name }] }    (Service sheet CSI)
//   listEmailSenders   → { ok, senders:[{ senderEmail, enabled, ... }] }
//   saveEmailSender    { senderEmail, subjectPattern, jobSource, jobPattern?,
//                        vendorId, costCode, enabled } → { ok, sender }
//   deleteEmailSender  { senderEmail } → { ok }
//   setEmailSenderEnabled { senderEmail, enabled } → { ok, sender }
//
// resolveEmailLink runs a dry-run Gemini/OCR extraction inline in Apps Script
// (~15–45s), so allow a longer function timeout than the default (the effective
// ceiling still depends on the Vercel plan — 60s Hobby / up to 300s Pro).
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

  const action = String(body.action ?? "");
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: `Unsupported action: ${action || "(none)"}` }, { status: 400 });
  }

  try {
    // Apps Script web apps answer via a 302 to a one-time content URL and always
    // report HTTP 200 there — success/failure is the "ok" field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, secret }),
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
