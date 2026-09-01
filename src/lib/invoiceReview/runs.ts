/**
 * The review's HISTORY — every run that has happened, kept.
 *
 * WHY THIS EXISTS. Before this module a review was computed, read on screen,
 * and discarded. Three things were therefore impossible: showing a month
 * instantly instead of re-reading JobTread, Drive and Gmail for it; telling a
 * NEW problem from one that has been sitting there unfixed since March; and
 * learning what "normal" looks like for a customer, which is what any anomaly
 * check has to be measured against. History is the foundation the learning
 * layer is built on — it is deliberately the first thing built, not the last.
 *
 * A run is APPENDED, never overwritten. Re-reviewing a month as the office
 * works through it is the normal case, and that sequence of runs is the record
 * of the month being fixed. `readLatestRun` is "the current view of this
 * month"; `listRuns` is how it got there.
 *
 * WHAT IT WRITES. One row per run, in the companion's own database. Nothing
 * here reaches JobTread, Drive, Gmail or the Sheet — saving a review still
 * cannot change anything the review looked at, which is the invariant the whole
 * feature rests on.
 *
 * Every function is BEST-EFFORT by contract: a companion DB that is unreachable
 * must never cost the office the review itself. `saveRun` swallows its error
 * and reports it, the readers return null/[] — the caller falls back to running
 * live, which is exactly what it did before this file existed.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewRuns } from "@/db/schema";

import type { Finding, MonthEvidence, ReviewPayload } from "./types";

/** A stored run, without the payload — enough to draw a trend or a freshness
 *  line, cheap enough to read a year of. */
export interface RunSummary {
  id: number;
  ym: string;
  ranAt: string;
  ranBy: string;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  suppressedCount: number;
  amountAtStake: number;
  captureComplete: boolean;
  evidenceWarningCount: number;
  evidenceHash: string;
  durationMs: number;
}

/** A stored run with the review it holds. `payload` is null when the stored
 *  JSON could not be parsed — a corrupt row must not throw on read. */
export interface StoredRun extends RunSummary {
  payload: ReviewPayload | null;
}

/**
 * A fingerprint of what the checks were run against.
 *
 * Two runs with the same hash looked at the same world, so nothing about the
 * month changed between them — which is what makes "nothing has moved since
 * Tuesday" answerable without diffing two payloads. Deliberately built from the
 * EVIDENCE and not the findings: findings also move when a ruling is recorded
 * or a check is retuned, and neither of those is a change to the month.
 *
 * Cheap and non-cryptographic (FNV-1a). It only ever has to answer "did this
 * change?", never to resist anyone trying to make two months collide.
 */
export function hashEvidence(month: MonthEvidence): string {
  const shape = JSON.stringify({
    ym: month.ym,
    emailChecked: month.emailChecked,
    mailTruncated: month.mailTruncated,
    emails: month.emails.map((e) => [e.threadId, e.matchedBillId, e.vendorId]),
    jobs: month.jobs.map((j) => [
      j.jobId,
      j.draftBillCount,
      j.draftBillsCost,
      j.uninvoicedTimeCost,
      j.folder?.found ?? false,
      (j.folder?.files ?? []).map((f) => [f.id, f.amount]),
      j.bills.map((b) => [b.id, b.cost, b.status, b.invoiced, b.invoiceIds.join(",")]),
      j.invoices.map((i) => [i.id, i.price, i.priceWithTax, i.tax, i.cost, i.amountPaid, i.issueDate]),
    ]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < shape.length; i++) {
    h ^= shape.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The denormalized counts stored beside a payload. Live = not suppressed: a
 *  finding the office has already ruled on is not a thing to fix. */
function tally(findings: Finding[]) {
  const live = findings.filter((f) => !f.suppressedBy);
  return {
    errorCount: live.filter((f) => f.severity === "error").length,
    warningCount: live.filter((f) => f.severity === "warning").length,
    infoCount: live.filter((f) => f.severity === "info").length,
    suppressedCount: findings.length - live.length,
    amountAtStake: live.reduce((s, f) => s + Math.abs(f.amount ?? 0), 0),
  };
}

/**
 * Record a run. Returns the reason it could not be saved, or "" on success —
 * never throws.
 *
 * A review that ran fine but could not be filed is still a good review, so the
 * caller shows it either way. The reason is returned rather than swallowed so
 * "history stopped filling up three weeks ago" is answerable.
 */
export async function saveRun(payload: ReviewPayload, by: string): Promise<string> {
  try {
    await ensureDb();
    await db.insert(invoiceReviewRuns).values({
      ym: payload.evidence.ym,
      ranAt: payload.generatedAt,
      ranBy: by,
      payload: JSON.stringify(payload),
      ...tally(payload.findings),
      // Only true when the mailbox question was actually ANSWERED. A skipped or
      // truncated sweep proves nothing about what it did not see, and a trend
      // line that treats those as clean months is worse than no trend line.
      captureComplete: payload.evidence.emailChecked && !payload.evidence.mailTruncated,
      evidenceWarningCount: payload.evidence.warnings.length,
      evidenceHash: hashEvidence(payload.evidence),
      durationMs: payload.durationMs,
    });
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "unknown error";
  }
}

function toSummary(r: typeof invoiceReviewRuns.$inferSelect): RunSummary {
  return {
    id: r.id,
    ym: r.ym,
    ranAt: r.ranAt,
    ranBy: r.ranBy,
    errorCount: r.errorCount,
    warningCount: r.warningCount,
    infoCount: r.infoCount,
    suppressedCount: r.suppressedCount,
    amountAtStake: r.amountAtStake,
    captureComplete: r.captureComplete,
    evidenceWarningCount: r.evidenceWarningCount,
    evidenceHash: r.evidenceHash,
    durationMs: r.durationMs,
  };
}

/**
 * The most recent run for a billing month, payload included — or null if the
 * month has never been reviewed (or the DB is unreachable).
 *
 * This is what lets the page open a month instantly. A stored payload re-renders
 * exactly as it did live, because it IS what was live: no JobTread, Drive or
 * Gmail call is made to show it.
 */
export async function readLatestRun(ym: string): Promise<StoredRun | null> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewRuns)
      .where(eq(invoiceReviewRuns.ym, ym))
      .orderBy(desc(invoiceReviewRuns.ranAt), desc(invoiceReviewRuns.id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    let payload: ReviewPayload | null = null;
    try {
      payload = JSON.parse(row.payload) as ReviewPayload;
    } catch {
      // A row whose JSON won't parse is still evidence that a run happened, and
      // its counts are still readable. Hand back the summary and let the caller
      // re-run for the detail rather than failing the whole read.
      payload = null;
    }
    return { ...toSummary(row), payload };
  } catch {
    return null;
  }
}

/**
 * Past runs, newest first — the whole history when `ym` is omitted, one month's
 * when it isn't. Payload-free, so this stays cheap enough to chart.
 */
export async function listRuns(ym?: string, limit = 50): Promise<RunSummary[]> {
  try {
    await ensureDb();
    const base = db.select().from(invoiceReviewRuns);
    const q = ym ? base.where(eq(invoiceReviewRuns.ym, ym)) : base;
    const rows = await q
      .orderBy(desc(invoiceReviewRuns.ranAt), desc(invoiceReviewRuns.id))
      .limit(Math.max(1, Math.min(500, limit)));
    return rows.map(toSummary);
  } catch {
    return [];
  }
}
