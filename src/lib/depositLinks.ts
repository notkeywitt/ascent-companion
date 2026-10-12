/**
 * JOB DEPOSITS — the companion's `deposit_links` table: the deposit the office
 * entered by hand for a job whose deposit predates JobTread. One row per job.
 * Draws are read live from JobTread; rules in src/lib/deposits.ts.
 */
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { depositLinks } from "@/db/schema";
import type { EnteredDeposit } from "@/lib/deposits";

export interface StoredDeposit {
  entered: EnteredDeposit | null;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

export async function readEnteredDeposit(jobId: string): Promise<StoredDeposit> {
  await ensureDb();
  const [row] = await db.select().from(depositLinks).where(eq(depositLinks.jobId, jobId));
  return {
    entered:
      row && typeof row.depositAmount === "number"
        ? { amount: row.depositAmount, previouslyApplied: row.previouslyApplied ?? 0 }
        : null,
    note: row?.note ?? "",
    updatedAt: row?.updatedAt ?? "",
    updatedBy: row?.updatedBy ?? "",
  };
}

/** Set (or, with null, clear) the deposit entered by hand. */
export async function setEnteredDeposit(
  jobId: string,
  entered: EnteredDeposit | null,
  note: string,
  by: string,
): Promise<void> {
  await ensureDb();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const patch = {
    depositAmount: entered ? r2(entered.amount) : null,
    previouslyApplied: entered ? r2(entered.previouslyApplied) : 0,
    note: note.slice(0, 500),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  await db
    .insert(depositLinks)
    .values({ jobId, ...patch })
    .onConflictDoUpdate({ target: depositLinks.jobId, set: patch });
}
