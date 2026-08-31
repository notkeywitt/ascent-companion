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
 * This is the ONLY thing the Daily Digest writes anywhere.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { dailyDigest } from "@/db/schema";
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
