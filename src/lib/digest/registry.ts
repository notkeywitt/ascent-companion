/**
 * THE CHECK REGISTRY — the one list of checks the digest runs.
 *
 * ── ADDING A CHECK ──────────────────────────────────────────────────────────
 *   1. Write `checks/myCheck.ts` exporting a `defineCheck({...})`.
 *   2. Add its config block to `settings.ts` under the same id.
 *   3. Add it to `CHECKS` below.
 * That's the whole job. The aggregator (`run.ts`), the scheduled route, the
 * store and the UI are all driven by this list and by the category the check
 * names — none of them needs to know a new check exists.
 *
 * ── WHY `enabled` AND `config` COME FROM SETTINGS ───────────────────────────
 * A check file declares BEHAVIOR; `settings.ts` declares POLICY. So the check
 * objects below are rebuilt here with their settings block bound in, which is
 * what keeps every threshold and exclusion list in one editable file instead of
 * scattered as constants through the check code. A check whose id has no
 * settings block is treated as disabled and says so loudly at startup — that's
 * the typo case, and silently not running a check is the worst possible failure
 * for a system whose whole job is noticing things.
 */
import { DIGEST_SETTINGS } from "./settings";
import type { DigestCheck } from "./types";

import { uncapturedBillsCheck } from "./checks/uncapturedBills";
import { draftBillsPastCutoffCheck } from "./checks/draftBillsPastCutoff";
import { reconciliationFlagsCheck } from "./checks/reconciliationFlags";
import { costVsInvoiceCheck } from "./checks/costVsInvoice";
import { calendarEventsCheck } from "./checks/calendarEvents";
import { jobtreadScheduleCheck } from "./checks/jobtreadSchedule";
import { jobtreadTodosCheck } from "./checks/jobtreadTodos";
import { emailFollowUpsCheck } from "./checks/emailFollowUps";
import { emailSignalsCheck } from "./checks/emailSignals";

/** Every check that exists, in the order they run and are displayed within a category. */
const DECLARED: DigestCheck<never>[] = [
  // Calendar
  calendarEventsCheck,
  jobtreadScheduleCheck,
  // To-Do
  jobtreadTodosCheck,
  emailSignalsCheck,
  // Follow-ups
  emailFollowUpsCheck,
  // Billing — OFF by default (settings.ts); billing has its own screens.
  uncapturedBillsCheck,
  draftBillsPastCutoffCheck,
  reconciliationFlagsCheck,
  costVsInvoiceCheck,
] as unknown as DigestCheck<never>[];

export type SettingsBlock = { enabled: boolean; config: unknown };

/**
 * Bind every declared check to a settings map — DEFAULT_SETTINGS unless a
 * caller passes an override-merged one (see `resolveChecks` in
 * `overrides.ts`, which layers /admin's DB overrides on top of DIGEST_SETTINGS
 * before calling this). Pulled out as its own function so both the static
 * `CHECKS` below and the live, override-aware resolver share one
 * implementation instead of two copies that could drift.
 *
 * A check with no matching settings block is returned disabled rather than
 * dropped, so `/api/digest` can report "configured but not running" instead of
 * the check quietly vanishing.
 */
export function bindChecks(
  settingsMap: Record<string, SettingsBlock | undefined> = DIGEST_SETTINGS,
): DigestCheck<never>[] {
  return DECLARED.map((check) => {
    const block = settingsMap[check.id];
    if (!block) {
      return { ...check, enabled: false, config: {} as never };
    }
    return { ...check, enabled: block.enabled, config: block.config as never };
  });
}

/** The registry: every declared check with its settings.ts block bound in. */
export const CHECKS: DigestCheck<never>[] = bindChecks();

/** Just the checks that will actually run. */
export function enabledChecks(): DigestCheck<never>[] {
  return CHECKS.filter((c) => c.enabled);
}

/** Ids of checks that exist but are switched off (or missing a settings block). */
export function disabledCheckIds(): string[] {
  return CHECKS.filter((c) => !c.enabled).map((c) => c.id);
}
