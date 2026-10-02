/**
 * The pay-type rules table (server side): employee + job + cost code → pay
 * type. Edited on /labor-rates, read by every time entry point. The match
 * itself is in lib/payTypeMatch, so the browser can run it too.
 */
import { and, asc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { costCodeDefaults, payTypeRules } from "@/db/schema";
import type { CostCodeDefault, PayTypeRule } from "@/lib/payTypeMatch";

const toRule = (r: typeof payTypeRules.$inferSelect): PayTypeRule => ({
  id: r.id,
  jtUserId: r.jtUserId,
  jobId: r.jobId,
  jobName: r.jobName,
  costCode: r.costCode,
  payType: r.payType,
});

/** Every rule, or one employee's. */
export async function listPayTypeRules(jtUserId?: string): Promise<PayTypeRule[]> {
  await ensureDb();
  const rows = await db
    .select()
    .from(payTypeRules)
    .where(jtUserId ? eq(payTypeRules.jtUserId, jtUserId) : undefined)
    .orderBy(asc(payTypeRules.jobName), asc(payTypeRules.costCode));
  return rows.map(toRule);
}

/** Add a rule, or replace the pay type on the one already there for that set. */
export async function savePayTypeRule(
  rule: Omit<PayTypeRule, "id">,
  updatedBy: string,
): Promise<PayTypeRule> {
  await ensureDb();
  const row = { ...rule, updatedAt: new Date().toISOString(), updatedBy };
  await db
    .insert(payTypeRules)
    .values(row)
    .onConflictDoUpdate({
      target: [payTypeRules.jtUserId, payTypeRules.jobId, payTypeRules.costCode],
      set: { payType: row.payType, jobName: row.jobName, updatedAt: row.updatedAt, updatedBy },
    });
  const [saved] = await db
    .select()
    .from(payTypeRules)
    .where(
      and(
        eq(payTypeRules.jtUserId, rule.jtUserId),
        eq(payTypeRules.jobId, rule.jobId),
        eq(payTypeRules.costCode, rule.costCode),
      ),
    );
  return toRule(saved);
}

export async function deletePayTypeRule(id: number): Promise<void> {
  await ensureDb();
  await db.delete(payTypeRules).where(eq(payTypeRules.id, id));
}

/* ── default cost codes: employee + job → cost code ───────────────────────── */

const toDefault = (r: typeof costCodeDefaults.$inferSelect): CostCodeDefault => ({
  id: r.id,
  jtUserId: r.jtUserId,
  jobId: r.jobId,
  jobName: r.jobName,
  costCode: r.costCode,
});

export async function listCostCodeDefaults(jtUserId?: string): Promise<CostCodeDefault[]> {
  await ensureDb();
  const rows = await db
    .select()
    .from(costCodeDefaults)
    .where(jtUserId ? eq(costCodeDefaults.jtUserId, jtUserId) : undefined)
    .orderBy(asc(costCodeDefaults.jobName));
  return rows.map(toDefault);
}

/** Set (or replace) an employee's default cost code on a job. */
export async function saveCostCodeDefault(d: Omit<CostCodeDefault, "id">, updatedBy: string): Promise<CostCodeDefault> {
  await ensureDb();
  const row = { ...d, updatedAt: new Date().toISOString(), updatedBy };
  await db
    .insert(costCodeDefaults)
    .values(row)
    .onConflictDoUpdate({
      target: [costCodeDefaults.jtUserId, costCodeDefaults.jobId],
      set: { costCode: row.costCode, jobName: row.jobName, updatedAt: row.updatedAt, updatedBy },
    });
  const [saved] = await db
    .select()
    .from(costCodeDefaults)
    .where(and(eq(costCodeDefaults.jtUserId, d.jtUserId), eq(costCodeDefaults.jobId, d.jobId)));
  return toDefault(saved);
}

export async function deleteCostCodeDefault(id: number): Promise<void> {
  await ensureDb();
  await db.delete(costCodeDefaults).where(eq(costCodeDefaults.id, id));
}
