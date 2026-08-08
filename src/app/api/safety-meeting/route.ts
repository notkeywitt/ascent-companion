import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy to the Apps Script web app's `saveSafetyMeeting` action. Apps Script
// holds the Sheets + Drive grants, so it writes the attendance rows, saves each
// signature PNG, and renders the signed roster PDF into Drive. The Assistant is
// only the iPad UI. Same shared secret as /api/email (kept server-side).
//
// POST body forwarded (secret injected):
//   { date, topic, admin, attendees: [{ name, position?, signaturePng }] }
// → { ok, meetingId, count, folderUrl, pdfUrl }
//
// Signature PNGs travel as base64 data URLs in the body and the Doc→PDF render
// takes a few seconds, so allow a longer function timeout (the effective ceiling
// still depends on the Vercel plan — 60s Hobby / up to 300s Pro).
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Writes the sign-in rows, the Drive roster PDF and the meeting record; stay
  // just under this route's maxDuration (120s). A write, so never retried.
  return callAppsScriptResponse({ ...body, action: "saveSafetyMeeting" }, { timeoutMs: 110_000 });
}
