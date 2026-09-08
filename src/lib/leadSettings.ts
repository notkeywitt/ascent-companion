/**
 * The quiet thresholds, read from the DB — when a lead with no logged contact
 * turns amber, and when it turns red.
 *
 * Server-only (it touches the DB), which is why it is not in `leadBoard.ts`:
 * that module is client-safe and holds the pure half — the defaults, the
 * validation (`normalizeThresholds`) and the banding (`quietBand`).
 *
 * ONE ROW, org-wide (`lead_settings`). No row means the defaults, so the table
 * only ever holds a deliberate change. Read fresh rather than cached: the
 * whole point of the setting is that moving it shows up on the next load.
 */
import { eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { LEAD_SETTINGS_ID, leadSettings, type LeadSettingsRow } from "@/db/schema";
import { normalizeThresholds, type LeadQuietThresholds } from "@/lib/leadBoard";

/** The stored row, or undefined when nobody has changed the thresholds. */
export async function readLeadSettingsRow(): Promise<LeadSettingsRow | undefined> {
  await ensureDb();
  const [row] = await db.select().from(leadSettings).where(eq(leadSettings.id, LEAD_SETTINGS_ID));
  return row;
}

/**
 * The thresholds in force. Normalized on the way OUT as well as in, so a row
 * written before a later validation rule tightened can't paint a broken pair.
 */
export async function readQuietThresholds(): Promise<LeadQuietThresholds> {
  const row = await readLeadSettingsRow();
  return normalizeThresholds({ warnDays: row?.warnDays, alertDays: row?.alertDays });
}

/** Write them, recording who moved them. Returns the pair actually stored. */
export async function writeQuietThresholds(
  raw: Partial<Record<keyof LeadQuietThresholds, unknown>>,
  email: string,
): Promise<{ quiet: LeadQuietThresholds; updatedAt: string }> {
  // normalize decides what is storable: it CLAMPS rather than rejects, so a
  // typed 0 or a swapped pair saves as the nearest sane thing instead of
  // failing under the user.
  const quiet = normalizeThresholds(raw);
  const updatedAt = new Date().toISOString();
  await ensureDb();
  await db
    .insert(leadSettings)
    .values({ id: LEAD_SETTINGS_ID, ...quiet, updatedAt, updatedBy: email })
    .onConflictDoUpdate({
      target: leadSettings.id,
      set: { ...quiet, updatedAt, updatedBy: email },
    });
  return { quiet, updatedAt };
}
