/**
 * The Daily Digest's STANDING INSTRUCTIONS — the owner's durable "stop telling
 * me about…" / "always do…" preferences that shape how the morning brief is
 * written. Set via the reply box (src/app/api/digest/reply/route.ts) or Admin →
 * Digest, stored in the `digest_instructions` table (src/db/schema.ts).
 *
 * ⚠️ NOTHING READS THEM SINCE 2026-09-04. They existed to shape the brief's
 * prompt; the brief is now built from the check results with no model call
 * (`fallbackSummary` in ./run.ts). Add/list/remove still work — the rows are
 * kept so the preferences survive if a written brief returns.
 *
 * READ FRESH ON EVERY RUN, never baked into a session — the same reasoning as
 * getDigestOverrides in ./overrides.ts (the digest's caller is a scheduler with
 * no session). Fail-soft: an unreachable DB or a bad row degrades to "no
 * standing instructions" rather than breaking the digest, mirroring
 * getDigestOverrides and `activeIgnorePatterns` in checks/emailFollowUps.ts.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { digestInstructions } from "@/db/schema";

/**
 * Active standing instructions, newest first, as `{id, text}` — the shape the
 * reply box needs so a "forget that one" reply can reference an exact id (the
 * reply route re-validates the id, same as it does for todos/ignore rules).
 */
export async function getActiveInstructions(): Promise<{ id: number; text: string }[]> {
  try {
    await ensureDb();
    return await db
      .select({ id: digestInstructions.id, text: digestInstructions.text })
      .from(digestInstructions)
      .where(eq(digestInstructions.active, true))
      .orderBy(desc(digestInstructions.createdAt));
  } catch {
    return [];
  }
}

/** Just the instruction texts, for injecting into the digest summary prompt. */
export async function getInstructionTexts(): Promise<string[]> {
  return (await getActiveInstructions()).map((r) => r.text);
}
