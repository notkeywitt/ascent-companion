/**
 * JOB DEPOSITS — the companion's `deposit_links` table: the facts about a
 * deposit that JobTread has no field for (which job an account-level deposit
 * payment belongs to, the opening balance, the draw rule). One row per job.
 *
 * Every dollar of the balance itself is read live from JobTread; this table
 * only says how to read it. See DEPOSITS_PLAN.md §5.
 */
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { depositLinks, type DepositLinksRow } from "@/db/schema";
import type { DepositLinks, DrawRule } from "@/lib/deposits";

export interface StoredDepositLinks extends DepositLinks {
  note: string;
  updatedAt: string;
  updatedBy: string;
}

function parseIds(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
  } catch {
    return [];
  }
}

function drawRuleOf(row: DepositLinksRow | undefined): DrawRule | null {
  if (row?.drawRule === "whole") return { kind: "whole" };
  if (row?.drawRule === "fixed" && typeof row.drawAmount === "number" && row.drawAmount > 0) {
    return { kind: "fixed", amount: row.drawAmount };
  }
  return null;
}

/** This job's links, plus the payments the office gave to OTHER jobs. */
export async function readDepositLinks(jobId: string): Promise<StoredDepositLinks> {
  await ensureDb();
  // One row per job with a deposit — a handful. Reading them all is what lets
  // a payment assigned to Main House drop out of Bunkhouse's card.
  const rows = await db.select().from(depositLinks);
  const mine = rows.find((r) => r.jobId === jobId);
  return {
    paymentIds: parseIds(mine?.paymentIds),
    elsewherePaymentIds: rows.filter((r) => r.jobId !== jobId).flatMap((r) => parseIds(r.paymentIds)),
    opening:
      mine && typeof mine.openingAmount === "number" && mine.openingAsOf
        ? { amount: mine.openingAmount, asOf: mine.openingAsOf }
        : null,
    drawRule: drawRuleOf(mine),
    note: mine?.note ?? "",
    updatedAt: mine?.updatedAt ?? "",
    updatedBy: mine?.updatedBy ?? "",
  };
}

async function upsert(jobId: string, patch: Partial<DepositLinksRow>, by: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(depositLinks)
    .values({ jobId, ...patch, updatedAt: now, updatedBy: by })
    .onConflictDoUpdate({ target: depositLinks.jobId, set: { ...patch, updatedAt: now, updatedBy: by } });
}

/**
 * Give a deposit payment to this job — and take it from any other job, so one
 * payment can never be counted on two cards.
 */
export async function assignDepositPayment(jobId: string, paymentId: string, by: string): Promise<void> {
  await ensureDb();
  const rows = await db.select().from(depositLinks);
  for (const r of rows) {
    if (r.jobId === jobId) continue;
    const ids = parseIds(r.paymentIds);
    if (ids.includes(paymentId)) {
      await upsert(r.jobId, { paymentIds: JSON.stringify(ids.filter((x) => x !== paymentId)) }, by);
    }
  }
  const mine = parseIds(rows.find((r) => r.jobId === jobId)?.paymentIds);
  if (!mine.includes(paymentId)) {
    await upsert(jobId, { paymentIds: JSON.stringify([...mine, paymentId]) }, by);
  }
}

export async function unassignDepositPayment(jobId: string, paymentId: string, by: string): Promise<void> {
  await ensureDb();
  const [row] = await db.select().from(depositLinks).where(eq(depositLinks.jobId, jobId));
  const ids = parseIds(row?.paymentIds);
  if (ids.includes(paymentId)) {
    await upsert(jobId, { paymentIds: JSON.stringify(ids.filter((x) => x !== paymentId)) }, by);
  }
}

/** Set (or, with null, clear) the deposit left when the job moved into JobTread. */
export async function setDepositOpening(
  jobId: string,
  opening: { amount: number; asOf: string } | null,
  note: string,
  by: string,
): Promise<void> {
  await ensureDb();
  await upsert(
    jobId,
    {
      openingAmount: opening ? Math.round(opening.amount * 100) / 100 : null,
      openingAsOf: opening ? opening.asOf : null,
      note: note.slice(0, 500),
    },
    by,
  );
}
