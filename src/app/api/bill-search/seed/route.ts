import { NextRequest, NextResponse } from "next/server";
import { seedFromSheet } from "@/lib/billSearch";

/**
 * One-time seed of PRE-JobTread history into the bill search index, out of the
 * Expenditure/lineItem sheets (the archive that predates JobTread). Only rows the
 * sheet marks NOT-in-JobTread are imported — the live sweep owns everything else
 * — so seed + refresh together cover the whole record with no overlap.
 *
 *   POST /api/bill-search/seed { offset? } → { ok, processed, scanned, nextOffset, total, done }
 *
 * PAGED: one Expenditure page per call (each page also fetches its line items
 * from Apps Script, which is the slow part). The client loops, feeding
 * `nextOffset` back until `done`. Offset 0 clears any prior sheet-sourced rows,
 * so a re-run is a clean re-seed rather than a duplicate.
 *
 * Gated to the `bill-search` view by middleware. Reads the sheet via Apps Script
 * and writes only the local index — no JobTread or sheet writes.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → start from offset 0 */
  }
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);

  try {
    const progress = await seedFromSheet(offset);
    return NextResponse.json({ ok: true, ...progress }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Seed failed" },
      { status: 502 },
    );
  }
}
