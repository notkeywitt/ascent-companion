/**
 * Where a digest lives between the scheduled run that builds it and the home
 * screen that reads it.
 *
 * ONE ROW PER DAY, keyed by the company-timezone date, holding the STRUCTURED
 * results — not a rendered blob of text. That is what lets the UI re-render,
 * re-group and re-order a digest that was generated hours earlier, and what
 * lets a future feature ask "how many uncaptured bills did we average last
 * month?" without re-running anything. "Refresh now" rewrites the same row, so
 * a day never accumulates duplicates.
 *
 * The digest row and the dismissals below (one row per item the office marked
 * handled) are the ONLY things the Daily Digest writes anywhere.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { dailyDigest, digestDismissals } from "@/db/schema";
import type { DigestPayload, StoredCheckResult } from "./types";

/** Persist (or overwrite) the digest for its date. */
export async function saveDigest(payload: DigestPayload): Promise<void> {
  await ensureDb();
  const row = {
    date: payload.date,
    generatedAt: payload.generatedAt,
    status: payload.status,
    summary: payload.summary,
    summarySource: payload.summarySource,
    results: JSON.stringify(payload.results),
    durationMs: payload.durationMs,
    log: JSON.stringify(payload.log),
  };
  await db
    .insert(dailyDigest)
    .values(row)
    .onConflictDoUpdate({ target: dailyDigest.date, set: row });
}

/** Parse a stored row back into a payload, tolerating corrupt JSON. */
function hydrate(row: typeof dailyDigest.$inferSelect): DigestPayload {
  const parse = <T>(raw: string, fallback: T): T => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  return {
    date: row.date,
    generatedAt: row.generatedAt,
    status: (row.status as DigestPayload["status"]) ?? "ok",
    summary: row.summary,
    summarySource: (row.summarySource as DigestPayload["summarySource"]) ?? "fallback",
    results: parse<StoredCheckResult[]>(row.results, []),
    durationMs: row.durationMs,
    log: parse<string[]>(row.log, []),
  };
}

/** The digest for one date, or null if that day was never run. */
export async function readDigest(date: string): Promise<DigestPayload | null> {
  await ensureDb();
  const rows = await db.select().from(dailyDigest).where(eq(dailyDigest.date, date)).limit(1);
  return rows[0] ? hydrate(rows[0]) : null;
}

/**
 * The most recent digest of any date.
 *
 * Used when today's run hasn't happened yet (a cold morning before the cron, or
 * a deploy that missed it): showing yesterday's clearly-labelled digest beats
 * showing nothing, and the UI says how old it is.
 */
export async function readLatestDigest(): Promise<DigestPayload | null> {
  await ensureDb();
  const rows = await db.select().from(dailyDigest).orderBy(desc(dailyDigest.date)).limit(1);
  return rows[0] ? hydrate(rows[0]) : null;
}

/* ------------------------------------------------------------- dismissals */

/**
 * Every item key the office has dismissed and not undone — the set both the run
 * and GET /api/digest filter with (see `applyDismissals` in dismissals.ts).
 *
 * Fail-soft: an unreachable DB degrades to "nothing dismissed", so the digest
 * still renders in full rather than erroring over a hide list.
 */
export async function readActiveDismissals(): Promise<Set<string>> {
  try {
    await ensureDb();
    const rows = await db
      .select({ key: digestDismissals.key })
      .from(digestDismissals)
      .where(eq(digestDismissals.active, true));
    return new Set(rows.map((r) => r.key));
  } catch {
    return new Set();
  }
}

/** Dismiss one item, or re-dismiss one that was undone. Keyed, so it can't stack. */
export async function saveDismissal(row: {
  key: string;
  checkId: string;
  title: string;
  by: string;
}): Promise<void> {
  await ensureDb();
  const values = {
    key: row.key,
    checkId: row.checkId,
    title: row.title.slice(0, 300),
    dismissedBy: row.by,
    dismissedAt: new Date().toISOString(),
    active: true,
  };
  await db
    .insert(digestDismissals)
    .values(values)
    .onConflictDoUpdate({ target: digestDismissals.key, set: values });
}

/** Undo a dismissal — deactivated, not deleted, so the record survives. */
export async function liftDismissal(key: string): Promise<void> {
  await ensureDb();
  await db
    .update(digestDismissals)
    .set({ active: false })
    .where(eq(digestDismissals.key, key));
}
