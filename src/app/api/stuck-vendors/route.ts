import { unstable_cache } from "next/cache";
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

// Shared Data Cache for the unmatched-vendor alert. The banner mounts on every gated page,
// and the underlying action re-reads the whole Vendors + Expenditure tabs each call, so a
// short shared cache removes both the Apps Script double-hop AND the repeated recompute.
// Any failure (missing env, network, non-JSON, or an { ok:false } action error) THROWS so
// it is never cached — only a good result is; the next mount retries. The alert is org-wide
// (not user-scoped), so one shared entry is correct for every viewer.
const getCachedStuckVendors = unstable_cache(
  async () => {
    const url = process.env.APPS_SCRIPT_SYNC_URL;
    const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
    if (!url || !secret) {
      throw new Error("APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.");
    }
    // Apps Script web apps answer via a 302 to a one-time content URL and always report
    // HTTP 200 there — success/failure is the "ok" field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listStuckVendors", secret }),
      redirect: "follow",
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (parsed && typeof parsed === "object" && (parsed as { ok?: boolean }).ok === false) {
      throw new Error(String((parsed as { error?: unknown }).error ?? "listStuckVendors failed"));
    }
    return parsed;
  },
  ["api-stuck-vendors"],
  { revalidate: 60, tags: ["stuck-vendors"] },
);

// GET /api/stuck-vendors
//   → { ok, vendors: [{ vendor, count, taggedCount, bills:[…] }],
//       billCount, vendorCount, windowDays }
export async function GET() {
  if (!process.env.APPS_SCRIPT_SYNC_URL || !process.env.APPS_SCRIPT_SYNC_SECRET) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getCachedStuckVendors(), { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
