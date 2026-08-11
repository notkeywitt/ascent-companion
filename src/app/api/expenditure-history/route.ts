import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

/**
 * The pre-JobTread expenditure archive — proxied to the Apps Script doPost
 * router (ExpenditureHistory.js), which holds the Sheets grant. Same shape as
 * /api/tracking-sheet and /api/historical-cost: the Assistant is UI only.
 *
 *   GET  /api/expenditure-history?offset=0[&limit=6000][&refresh=1]
 *        → { ok, jobs[], vendors[], rows[][], columns[], offset, scanned,
 *            returned, total, done, generatedAt, sunsetVendorId }
 *   POST /api/expenditure-history { keys: string[] }
 *        → { ok, lines: { <ExpID|InvoiceID>: [{ id, desc, csi, qty, price,
 *                                               amount, source }] } }
 *
 * The GET is PAGED because the whole archive as one body would eventually pass
 * Vercel's 4.5 MB response cap; the page loops on `done`. See the header of
 * ExpenditureHistory.js for the row format.
 *
 * READ-ONLY end to end — neither action writes to the sheet, Drive, or
 * JobTread, so nothing here can race the hourly mirror.
 *
 * Gated by middleware on the `expenditure-history` view (see lib/views.ts).
 *
 * Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
 */
export const dynamic = "force-dynamic";
// One page is a bounded range read, but the POST scans all three child tabs.
// Both are sheet work on a multi-year archive, so give them room.
export const maxDuration = 120;

/**
 * In-process memo, keyed by page.
 *
 * Deliberately NOT `unstable_cache`: a page of the archive can approach the Data
 * Cache's 2 MB per-entry ceiling, where it would silently not be cached at all
 * and every visit would pay the sheet read again. A module-level memo survives
 * for the life of a warm lambda, which covers the case that actually matters —
 * the owner opening the page, backing out, and opening it again. It is history:
 * ten minutes costs nothing in freshness, and `?refresh=1` skips it outright.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; payload: unknown }>();

export async function GET(req: NextRequest) {
  if (!process.env.APPS_SCRIPT_SYNC_URL || !process.env.APPS_SCRIPT_SYNC_SECRET) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
  }

  const params = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limitRaw = Number(params.get("limit") ?? 0) || 0;
  const forceFresh = params.get("refresh") === "1";

  const key = `${offset}:${limitRaw}`;
  if (forceFresh) {
    // A reload means "the sheet changed" — drop the whole archive, not just the
    // page being asked for, or the later pages would still be the old read.
    cache.clear();
  } else {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json(hit.payload, { status: 200 });
    }
  }

  try {
    // Throws on missing env, network trouble, a non-JSON body, or { ok:false },
    // so a bad answer is never memoized. Stay under maxDuration (120s).
    const payload = await callAppsScriptOrThrow(
      { action: "listExpenditureHistory", offset, ...(limitRaw > 0 ? { limit: limitRaw } : {}) },
      { timeoutMs: 110_000 },
    );
    cache.set(key, { at: Date.now(), payload });
    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const keys = Array.isArray(body.keys)
    ? body.keys.map((k) => String(k ?? "").trim()).filter(Boolean)
    : [];
  if (keys.length === 0) {
    return NextResponse.json({ error: "keys must be a non-empty array." }, { status: 400 });
  }

  try {
    const payload = await callAppsScriptOrThrow(
      { action: "listExpenditureLines", keys },
      { timeoutMs: 110_000 },
    );
    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
