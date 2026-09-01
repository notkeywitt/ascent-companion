/**
 * THE REVIEW'S STANDING INSTRUCTIONS — how the owner wants the month read to
 * them, in their own words, remembered.
 *
 * "Always lead with anything on the Ferron job." "Don't bother telling me about
 * Shop." "If something's been standing more than two months, say so first."
 *
 * ## Not a ruling, and the difference matters
 *
 * A ruling changes what the review FINDS — it silences a finding, permanently,
 * and is recorded with a reason and a name against it. An instruction changes
 * nothing about what is found: every active row is injected into the summary
 * prompt on every run, so Claude shapes the PARAGRAPH around it. Nothing is
 * hidden, and no number moves.
 *
 * That distinction is what makes this safe to make easy. Getting an instruction
 * wrong costs a badly-ordered paragraph. Getting a ruling wrong costs a missed
 * charge.
 *
 * It is memory FOR CLAUDE, not a note the office reads back — the same split,
 * and the same reasoning, as `digest_instructions`.
 *
 * Deactivated rather than deleted, so "why did it stop leading with that" stays
 * answerable.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewInstructions } from "@/db/schema";

export interface ReviewInstruction {
  id: number;
  text: string;
  createdBy: string;
  createdAt: string;
}

/** The active instructions, oldest first — the order they are handed to Claude,
 *  so a later one reads as a refinement of an earlier one. */
export async function activeInstructions(): Promise<ReviewInstruction[]> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewInstructions)
      .where(eq(invoiceReviewInstructions.active, true))
      .orderBy(invoiceReviewInstructions.id);
    return rows.map((r) => ({ id: r.id, text: r.text, createdBy: r.createdBy, createdAt: r.createdAt }));
  } catch {
    // No instructions is a perfectly good state; the summary is simply unshaped.
    return [];
  }
}

/** Every instruction including the retired ones, newest first — for the screen
 *  where they are managed. */
export async function listInstructions(): Promise<(ReviewInstruction & { active: boolean })[]> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewInstructions)
      .orderBy(desc(invoiceReviewInstructions.id));
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      active: r.active,
    }));
  } catch {
    return [];
  }
}

export async function addInstruction(text: string, by: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Say what you'd like it to do.");
  await ensureDb();
  await db.insert(invoiceReviewInstructions).values({
    text: trimmed.slice(0, 2000),
    active: true,
    createdBy: by,
    createdAt: new Date().toISOString(),
  });
}

/** Retire one. The row stays, so the history of what was asked for survives. */
export async function retireInstruction(id: number): Promise<void> {
  await ensureDb();
  await db
    .update(invoiceReviewInstructions)
    .set({ active: false })
    .where(eq(invoiceReviewInstructions.id, id));
}
