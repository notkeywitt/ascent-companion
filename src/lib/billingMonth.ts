/**
 * The billing month in force — read from the DB.
 *
 * Server-only (it touches the DB), which is why the RULE stays in
 * `src/lib/billing.ts`: that module is client-safe and holds the pure half —
 * the 10th cutoff, the ym parsing and `billingMonthStale`.
 *
 * ONE ROW, org-wide (`billing_month_setting`). No row means the automatic 10th
 * cutoff, so the table only ever holds a deliberate override. Read fresh, not
 * cached: the whole point is that switching the month shows up on the next
 * bill.
 *
 * TWO systems file bills, so the month has to reach both. This database row is
 * the source of truth and `/api/add-bill` reads it directly. `ascent-appscript`
 * cannot reach this database, so `mirrorBillingMonth` PUSHES the value into its
 * Script Property on every change (see `_configSetBillingMonthOverride`,
 * Config.js) — that is what carries it to the `_JT Invoice` Gmail capture, the
 * LSWDD statement split and the uncaptured-row push.
 */
import { eq } from "drizzle-orm";

import { appsScriptConfigured, callAppsScript } from "@/lib/appsScript";
import { db, ensureDb } from "@/db";
import { BILLING_MONTH_SETTING_ID, billingMonthSetting } from "@/db/schema";
import { deriveBillingPeriod, parseBillingYm, ymOf, type BillingPeriod } from "@/lib/billing";

export interface BillingMonthState {
  /** The month in force, "2026-09" — the override when set, else the cutoff's. */
  ym: string;
  /** The set month, or "" when the automatic cutoff is deciding. */
  override: string;
  updatedAt: string;
  updatedBy: string;
}

/** The set billing month, or "" when nobody has overridden the cutoff. */
export async function readBillingMonthOverride(): Promise<string> {
  await ensureDb();
  const [row] = await db
    .select()
    .from(billingMonthSetting)
    .where(eq(billingMonthSetting.id, BILLING_MONTH_SETTING_ID));
  // Validated on the way OUT as well as in: a row written by hand can't paint a
  // month that isn't one.
  return parseBillingYm(row?.ym) ? row.ym : "";
}

/** The month in force plus who set it — what the home masthead renders. */
export async function readBillingMonth(now = new Date()): Promise<BillingMonthState> {
  await ensureDb();
  const [row] = await db
    .select()
    .from(billingMonthSetting)
    .where(eq(billingMonthSetting.id, BILLING_MONTH_SETTING_ID));
  const override = parseBillingYm(row?.ym) ? row.ym : "";
  return {
    ym: override || ymOf(deriveBillingPeriod(now, false)),
    override,
    updatedAt: row?.updatedAt ?? "",
    updatedBy: row?.updatedBy ?? "",
  };
}

/** The period every "current billing month" server read should use. */
export async function currentBillingPeriod(now = new Date()): Promise<BillingPeriod> {
  return deriveBillingPeriod(now, false, await readBillingMonthOverride());
}

/** What the push to Apps Script did. `skipped` = the bridge isn't configured. */
export interface BillingMonthMirror {
  ok: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Push the month into the Apps Script project, so bills captured THERE file
 * into it too.
 *
 * Retried on purpose, against this module's default: `setBillingMonth` writes a
 * Script Property to a fixed value, so running it twice leaves exactly what
 * running it once leaves. The usual "a retry writes the row twice" hazard does
 * not apply.
 *
 * Returns rather than throws. The caller decides what a failed push means — and
 * it means a real divergence, because the two sides would then date the same
 * bill differently.
 */
export async function mirrorBillingMonth(ym: string): Promise<BillingMonthMirror> {
  if (!appsScriptConfigured()) return { ok: false, skipped: true };
  const r = await callAppsScript<{ ok?: boolean; error?: unknown }>(
    { action: "setBillingMonth", ym },
    { retry: true },
  );
  if (r.error) return { ok: false, skipped: false, error: r.error };
  if (r.data?.ok === false) {
    return { ok: false, skipped: false, error: String(r.data.error ?? "Apps Script refused it.") };
  }
  return { ok: true, skipped: false };
}

/**
 * Set the billing month, or clear it back to the automatic cutoff with "".
 * Returns the state now in force. Rejects anything that isn't a month.
 */
export async function writeBillingMonth(
  raw: unknown,
  email: string,
): Promise<BillingMonthState | null> {
  const ym = String(raw ?? "").trim();
  if (ym !== "" && !parseBillingYm(ym)) return null;
  await ensureDb();
  if (ym === "") {
    await db
      .delete(billingMonthSetting)
      .where(eq(billingMonthSetting.id, BILLING_MONTH_SETTING_ID));
  } else {
    const updatedAt = new Date().toISOString();
    await db
      .insert(billingMonthSetting)
      .values({ id: BILLING_MONTH_SETTING_ID, ym, updatedAt, updatedBy: email })
      .onConflictDoUpdate({
        target: billingMonthSetting.id,
        set: { ym, updatedAt, updatedBy: email },
      });
  }
  return readBillingMonth();
}
