import { NextResponse } from "next/server";

// Proxy the unmatched-vendor alert to the Apps Script doPost router
// (action "listStuckVendors" — Diagnostics.js).
//
// These are ingested bills that WROTE their sheet row fine and then failed to
// push because their vendor doesn't resolve to a JobTread account. The failure
// is otherwise invisible: the row is stamped "Push Failed" and the 15-minute
// "_JT Invoice ..." Gmail tag scan retries it forever, leaving only an Audit Log
// line. The Assistant turns this into a popup + home banner naming the vendor.
//
// Read-only — nothing here writes to the sheet, Drive, or JobTread.
//
// Gated by middleware on the `email` view (see lib/views.ts), the same gate the
// UI checks before it fetches, so visibility and access can't disagree.
//
// Env (shared with /api/email, /api/needs-project, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
export const maxDuration = 60;

// GET /api/stuck-vendors
//   → { ok, vendors: [{ vendor, count, taggedCount, bills:[…] }],
//       billCount, vendorCount, windowDays }
export async function GET() {
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
      body: JSON.stringify({ action: "listStuckVendors", secret }),
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
