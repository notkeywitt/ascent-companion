/**
 * The review's memory — what the office has already ruled on.
 *
 * WHY THIS EXISTS. A deterministic check has no judgement. It will report the
 * same "this deposit has no backup PDF" every single month, because it is
 * structurally true and will stay true forever. The first month that is useful;
 * the third month it is noise, and by the sixth the whole review gets skimmed.
 * A ruling is the office's answer — "we know, it's fine, here's why" — recorded
 * once and applied to every future run.
 *
 * A ruling NEVER changes a number and never touches JobTread. It only decides
 * whether a finding is shown as a problem. Suppressed findings are still
 * returned, carrying the reason and who gave it, so the review can show its
 * work and a ruling can be lifted without re-running anything.
 *
 * TWO SCOPES, and the difference matters:
 *   • "finding"  — this exact finding on this exact subject (one bill, one file,
 *                  one invoice). The default, and the safe one.
 *   • "job-kind" — every finding of this KIND on this job, forever. Use for a
 *                  standing arrangement ("this client's allowance draws never
 *                  have vendor backup"), not to quiet one awkward month.
 *
 * This is the ONLY thing the invoice review writes anywhere.
 */
import { and, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewRulings } from "@/db/schema";

import { jobKindKey, type Finding, type FindingKind, type SuppressionNote } from "./types";

export interface Ruling {
  key: string;
  kind: string;
  jobId: string;
  scope: "finding" | "job-kind";
  reason: string;
  createdBy: string;
  createdAt: string;
}

/** Every standing ruling. Small by nature — one row per thing the office has
 *  overruled — so it is read whole rather than filtered per review. */
export async function listRulings(): Promise<Ruling[]> {
  await ensureDb();
  const rows = await db
    .select()
    .from(invoiceReviewRulings)
    .where(eq(invoiceReviewRulings.active, true));
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    jobId: r.jobId,
    scope: r.scope === "job-kind" ? "job-kind" : "finding",
    reason: r.reason,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}

/**
 * Record a ruling. Idempotent on the key — ruling on the same finding twice
 * rewrites the reason rather than stacking rows, so the office can correct a
 * hastily-typed note.
 */
export async function recordRuling(input: {
  key: string;
  kind: FindingKind;
  jobId: string;
  scope: "finding" | "job-kind";
  reason: string;
  by: string;
}): Promise<void> {
  await ensureDb();
  // A job-kind ruling is stored under the wildcard key regardless of which
  // finding it was raised from, so it matches every sibling next month.
  const key = input.scope === "job-kind" ? jobKindKey(input.kind, input.jobId) : input.key;
  const row = {
    key,
    kind: input.kind,
    jobId: input.jobId,
    scope: input.scope,
    reason: input.reason.slice(0, 2000),
    createdBy: input.by,
    createdAt: new Date().toISOString(),
    active: true,
  };
  await db
    .insert(invoiceReviewRulings)
    .values(row)
    .onConflictDoUpdate({ target: invoiceReviewRulings.key, set: row });
}

/**
 * Lift a ruling — the finding comes back on the next review.
 *
 * Deactivates rather than deletes, so the audit trail of "we decided this was
 * fine in August and changed our minds in October" survives.
 */
export async function liftRuling(key: string): Promise<void> {
  await ensureDb();
  await db
    .update(invoiceReviewRulings)
    .set({ active: false })
    .where(and(eq(invoiceReviewRulings.key, key), eq(invoiceReviewRulings.active, true)));
}

/**
 * Mark the findings a standing ruling covers. Returns a new array; the input is
 * untouched, so the raw check output stays inspectable.
 */
export function applyRulings(findings: Finding[], rulings: Ruling[]): Finding[] {
  if (!rulings.length) return findings;
  const byKey = new Map(rulings.map((r) => [r.key, r]));
  return findings.map((f) => {
    const hit = byKey.get(f.key) ?? byKey.get(jobKindKey(f.kind, f.jobId));
    if (!hit) return f;
    const note: SuppressionNote = {
      reason: hit.reason,
      by: hit.createdBy,
      at: hit.createdAt,
      scope: hit.scope,
    };
    return { ...f, suppressedBy: note };
  });
}
