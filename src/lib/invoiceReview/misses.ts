/**
 * MISTAKES THE REVIEW DIDN'T CATCH — the training set.
 *
 * ## Why this is the important one
 *
 * Every other memory in this feature records what the review already knows. A
 * ruling teaches it to say LESS. A norm teaches it what usual looks like within
 * the things it already measures. Neither can ever give it a new sense.
 *
 * This one records where it was BLIND: the office found a billing mistake and
 * no check saw it. That is the only input from which a genuinely new check can
 * be written, which makes this the difference between a review that gets
 * quieter over time and one that gets better.
 *
 * ## Deliberately cheap to file
 *
 * Only `description` is required. A half-filled row saying "billed Ferron twice
 * for the same dumpster, spotted it reading the PDF" is worth far more than a
 * perfect row nobody had time to write — and a form that demands a job id and
 * an invoice number at the exact moment somebody is annoyed about a billing
 * error is a form that stays empty.
 *
 * `howCaught` is the field that most often says where a check should look, so
 * it is worth asking for even though it is optional.
 *
 * ## What happens to them
 *
 * `learn.ts` hands the accumulated log to Claude with the current check list
 * and asks what check would have caught these. The answer is a PROPOSAL a human
 * reads and accepts; nothing here ever writes a check by itself.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewMisses } from "@/db/schema";

export interface ReviewMiss {
  id: number;
  ym: string;
  description: string;
  amount: number;
  jobId: string;
  jobName: string;
  customerName: string;
  invoiceId: string;
  howCaught: string;
  shouldHaveBeenCaughtBy: string;
  addressedAt: string;
  addressedNote: string;
  recordedBy: string;
  recordedAt: string;
}

export interface RecordMissInput {
  description: string;
  ym?: string;
  amount?: number;
  jobId?: string;
  jobName?: string;
  customerName?: string;
  invoiceId?: string;
  howCaught?: string;
  shouldHaveBeenCaughtBy?: string;
  by: string;
}

/** File a miss. Throws only on a genuinely empty description — the caller is a
 *  route that wants to tell the office it didn't take. */
export async function recordMiss(input: RecordMissInput): Promise<number> {
  const description = input.description.trim();
  if (!description) throw new Error("Say what was wrong.");
  await ensureDb();
  const rows = await db
    .insert(invoiceReviewMisses)
    .values({
      ym: (input.ym ?? "").trim(),
      description: description.slice(0, 4000),
      amount: Number.isFinite(input.amount) ? Number(input.amount) : 0,
      jobId: (input.jobId ?? "").trim(),
      jobName: (input.jobName ?? "").trim(),
      customerName: (input.customerName ?? "").trim(),
      invoiceId: (input.invoiceId ?? "").trim(),
      howCaught: (input.howCaught ?? "").trim().slice(0, 2000),
      shouldHaveBeenCaughtBy: (input.shouldHaveBeenCaughtBy ?? "").trim(),
      recordedBy: input.by,
      recordedAt: new Date().toISOString(),
    })
    .returning({ id: invoiceReviewMisses.id });
  return rows[0]?.id ?? 0;
}

/** The log, newest first. Small by nature — one row per mistake that got
 *  through — so it is read whole. Empty when the DB is unreachable. */
export async function listMisses(limit = 200): Promise<ReviewMiss[]> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewMisses)
      .orderBy(desc(invoiceReviewMisses.recordedAt), desc(invoiceReviewMisses.id))
      .limit(Math.max(1, Math.min(1000, limit)));
    return rows.map((r) => ({ ...r }));
  } catch {
    return [];
  }
}

/**
 * Mark a miss as addressed — a check now exists that would catch it.
 *
 * This is the loop visibly closing, and it is the only status a miss has. There
 * is deliberately no "won't fix": a miss that is not worth a check is still
 * worth leaving on the log, because the next three like it might together be.
 */
export async function markMissAddressed(id: number, note: string): Promise<void> {
  await ensureDb();
  await db
    .update(invoiceReviewMisses)
    .set({ addressedAt: new Date().toISOString(), addressedNote: note.trim().slice(0, 2000) })
    .where(eq(invoiceReviewMisses.id, id));
}
