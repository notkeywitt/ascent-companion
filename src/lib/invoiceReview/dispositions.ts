/**
 * Claude's verdicts on a month's findings — stored, so an expensive pass is
 * read back rather than re-spent.
 *
 * A DISPOSITION IS NOT A RULING, and the gap between them is the whole safety
 * story of this feature. A ruling is the office saying "we looked, it's fine",
 * it is recorded with a name and a reason against it, and it SILENCES a finding
 * for good. A disposition is a model's reading of the same finding after
 * chasing it; it changes nothing, hides nothing, and exists only to tell a busy
 * person which item to open first.
 *
 * So `verdict: "probably-fine"` leaves the finding exactly where it was, at
 * full severity, in the same list. If the office agrees with that reading they
 * still have to record a ruling themselves.
 *
 * Best-effort throughout: an unreachable companion DB costs the investigation
 * its memory, never the review.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewDispositions } from "@/db/schema";

import type { DispositionInput } from "./investigateTools";
import type { Finding, FindingDisposition } from "./types";

/** Save a pass's verdicts. Re-investigating a month overwrites its verdicts:
 *  the newest reading is the one worth keeping, and the run history already
 *  records what the month looked like at each point in time. */
export async function saveDispositions(
  ym: string,
  model: string,
  items: DispositionInput[],
): Promise<string> {
  if (!items.length) return "";
  try {
    await ensureDb();
    const createdAt = new Date().toISOString();
    for (const d of items) {
      const row = {
        ym,
        key: d.key,
        verdict: d.verdict,
        why: d.why,
        suggestedAction: d.suggestedAction,
        model,
        createdAt,
      };
      await db
        .insert(invoiceReviewDispositions)
        .values(row)
        .onConflictDoUpdate({
          target: [invoiceReviewDispositions.ym, invoiceReviewDispositions.key],
          set: row,
        });
    }
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "unknown error";
  }
}

/** A month's verdicts, keyed by finding key. Empty when none or unreachable. */
export async function readDispositions(ym: string): Promise<Map<string, FindingDisposition>> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewDispositions)
      .where(eq(invoiceReviewDispositions.ym, ym));
    return new Map(
      rows.map((r) => [
        r.key,
        {
          verdict: r.verdict as FindingDisposition["verdict"],
          why: r.why,
          suggestedAction: r.suggestedAction,
          model: r.model,
          at: r.createdAt,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** Drop a month's verdicts — used when the findings have moved on enough that
 *  yesterday's reading would mislead. */
export async function clearDispositions(ym: string, keys?: string[]): Promise<void> {
  await ensureDb();
  await db
    .delete(invoiceReviewDispositions)
    .where(
      keys?.length
        ? and(eq(invoiceReviewDispositions.ym, ym), inArray(invoiceReviewDispositions.key, keys))
        : eq(invoiceReviewDispositions.ym, ym),
    );
}

/**
 * Stamp findings with any verdict on record. Returns a new array; the input is
 * untouched, so the raw check output stays inspectable — the same rule
 * `applyRulings` and `attachHistory` both follow.
 */
export function attachDispositions(
  findings: Finding[],
  byKey: Map<string, FindingDisposition>,
): Finding[] {
  if (!byKey.size) return findings;
  return findings.map((f) => {
    const d = byKey.get(f.key);
    return d ? { ...f, disposition: d } : f;
  });
}
