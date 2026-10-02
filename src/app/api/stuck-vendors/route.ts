import { revalidateTag, unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

// Proxy the unmatched-vendor alert to the Apps Script doPost router
// (action "listStuckVendors" — Diagnostics.js).
//
// These are ingested bills that WROTE their sheet row fine and then failed to
// push because their vendor doesn't resolve to a JobTread account. The failure
// is otherwise invisible: the row is stamped "Push Failed" and the 15-minute
// "_JT Invoice ..." Gmail tag scan retries it forever, leaving only an Audit Log
// line. The Assistant turns this into a popup + home banner naming the vendor.
//
// GET is read-only. POST is the one write: "forget this bill" (below). It
// touches the sheet, Drive and Gmail, never JobTread.
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
    // Throws on every failure — missing env, network, non-JSON, or { ok:false } —
    // which is exactly what unstable_cache needs so a bad result is never cached.
    // A read, so the client retries it automatically. Stay under maxDuration (60s).
    return await callAppsScriptOrThrow({ action: "listStuckVendors" }, { timeoutMs: 50_000 });
  },
  ["api-stuck-vendors"],
  { revalidate: 60, tags: ["stuck-vendors"] },
);

// GET /api/stuck-vendors[?refresh=1]
//   → { ok, vendors: [{ vendor, count, taggedCount, bills:[…] }],
//       billCount, vendorCount, windowDays }
//
// `refresh=1` skips the cache entirely (and drops the cached entry) — the
// banner's Refresh button sends it. Without that, the button re-fetched a route
// that answered from the 60s shared cache, so "I created the vendor, now clear
// the warning" appeared to do nothing and the owner had no way to force a look.
export async function GET(req: NextRequest) {
  if (!process.env.APPS_SCRIPT_SYNC_URL || !process.env.APPS_SCRIPT_SYNC_SECRET) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
  }
  const forceFresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    if (forceFresh) {
      const fresh = await callAppsScriptOrThrow({ action: "listStuckVendors" }, { timeoutMs: 50_000 });
      // Drop the stale entry so every other mount agrees with what we just read.
      revalidateTag("stuck-vendors");
      return NextResponse.json(fresh, { status: 200 });
    }
    return NextResponse.json(await getCachedStuckVendors(), { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

// POST /api/stuck-vendors { expId }
//   → forgetStuckBill → { ok, expId, trashed, untagged }
//
// "Forget all about this one": takes the "_JT Invoice" tag off the source email,
// deletes the Expenditure + lineItem rows and bins the PDF. Re-tagging the email
// later captures it fresh. Destructive, so confirm:true is sent here explicitly —
// the Apps Script handler refuses without it, and refuses a bill already in JobTread.
export async function POST(req: NextRequest) {
  let body: { expId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const expId = String(body.expId ?? "").trim();
  if (!expId) return NextResponse.json({ error: "expId is required." }, { status: 400 });
  try {
    const res = await callAppsScriptOrThrow({ action: "forgetStuckBill", expId, confirm: true }, { timeoutMs: 50_000 });
    revalidateTag("stuck-vendors");
    return NextResponse.json(res, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
