/**
 * The pay-type rules table (server side): employee + job + cost code → pay
 * type. Edited on /labor-rates, read by every time entry point. The match
 * itself is in lib/payTypeMatch, so the browser can run it too.
 */
import { and, asc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { payTypeRules } from "@/db/schema";
import type { PayTypeRule } from "@/lib/payTypeMatch";

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
