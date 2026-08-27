import { NextResponse } from "next/server";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { reindexFromJobTread, getIndexStatus } from "@/lib/billSearch";

/**
 * Rebuild the live (JobTread) half of the bill search index.
 *
 *   POST /api/bill-search/refresh  → { ok, indexed }         (sweep ran)
 *                                     { ok, skipped:true }   (another sweep holds the lock)
 *
 * JobTread documents carry no `updatedAt`, so there's no way to pull "just the
 * changed bills" — the sweep is a full re-index of every vendorBill and its
 * lines. That's why it isn't run on every search: the page fires it only when
 * the index has gone stale, and a lock keeps concurrent searchers from each
 * launching one. Heavy but bounded; the long timeout gives the sweep room.
 *
 * Gated to the `bill-search` view by middleware. This is a companion-owned CACHE
 * write only — it reads JobTread and writes the local index; it never mutates
 * JobTread, so it sits outside the write gates entirely.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JobTread grant key is not configured." }, { status: 400 });
  }
  try {
    const indexed = await reindexFromJobTread(getPaveConfig());
    if (indexed === null) {
      return NextResponse.json({ ok: true, skipped: true, status: await getIndexStatus() });
    }
    return NextResponse.json({ ok: true, indexed, status: await getIndexStatus() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 502 },
    );
  }
}
