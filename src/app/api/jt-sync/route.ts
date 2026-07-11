import { NextRequest, NextResponse } from "next/server";

// Proxy to the Apps Script full-sync web app (runFullJtSync): kicks the entire
// hourly JT→sheets/Drive sync flow immediately. The route sits behind the
// app's auth middleware; the shared secret stays server-side in env vars.
//
// Env:
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
// POST /api/jt-sync            → queue the sync (returns in ~1s)
// POST /api/jt-sync {wait:true}→ run inline and return the step summary
//                                (Apps Script may take minutes; only use where
//                                the platform timeout allows it)
export async function POST(req: NextRequest) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
  }

  let wait = false;
  try {
    const body = await req.json();
    wait = body?.wait === true;
  } catch {
    // empty body is fine — default to queued mode
  }

  try {
    // Apps Script web apps answer via a 302 to a one-time content URL and
    // always report HTTP 200 there — success/failure is the "ok" field.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, wait }),
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
