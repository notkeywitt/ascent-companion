/**
 * Month action stamps — when each month-closing action last ran, per billing
 * month. Server-only (it touches the DB). Table: `month_action_runs`.
 *
 * Recorded by the action's own route on success, so a run from any page
 * stamps: /api/document-access (a month's bills), /api/labor-report and
 * /api/tracking-sheet (op "sync"). Read by /api/month-actions for the Tracking
 * Sheets all-jobs cards.
 */
import { eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { monthActionRuns, type MonthActionRunRow } from "@/db/schema";

export type MonthAction = "document-access" | "labor-report" | "tracking-sync";

/**
 * Stamp one run, replacing the last stamp for the same action, scope and month.
 * Never throws: the action already happened, and a failed stamp must not turn
 * its success into an error.
 */
export async function recordMonthAction(
  action: MonthAction,
  scope: string,
  ym: string,
  by: string,
  note = "",
): Promise<void> {
  try {
    await ensureDb();
    const at = new Date().toISOString();
    await db
      .insert(monthActionRuns)
      .values({ action, scope, ym, at, by, note })
      .onConflictDoUpdate({
        target: [monthActionRuns.action, monthActionRuns.scope, monthActionRuns.ym],
        set: { at, by, note },
      });
  } catch (e) {
    console.error("[monthActions] stamp failed", action, scope, ym, e);
  }
}

/** Every stamp for one billing month. */
export async function listMonthActions(ym: string): Promise<MonthActionRunRow[]> {
  await ensureDb();
  return db.select().from(monthActionRuns).where(eq(monthActionRuns.ym, ym));
}
