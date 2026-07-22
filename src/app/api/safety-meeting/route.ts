import { NextRequest, NextResponse } from "next/server";

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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, action: "saveSafetyMeeting", secret }),
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
