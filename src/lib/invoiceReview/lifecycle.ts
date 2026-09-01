/**
 * WHAT HAPPENED TO EACH FINDING — how old it is, and whether it ever went away.
 *
 * ## The two questions this answers
 *
 * **"Is this new, or has it been there since March?"** A list where a fresh
 * problem and a nine-month-old one look identical gets skimmed, and a skimmed
 * review is a review that has stopped working. Age is the cheapest possible
 * fix and it needs no new evidence — only a memory of what the last run said.
 *
 * **"Is this check any good?"** False positives are the failure mode that kills
 * a monthly review, and until now nothing measured them. They are measurable,
 * because the office's ordinary work is already the signal:
 *
 *   • A finding that STOPS APPEARING was fixed → the check was right.
 *   • A finding that gets a RULING was set aside → the check cried wolf, or
 *     found a standing fact of the business it can't know about.
 *   • A finding that just sits there, run after run, with neither → nobody is
 *     acting on it, which is its own verdict on the check.
 *
 * Nobody has to score anything. That matters more than it sounds: any scheme
 * that asks the office to rate findings will be used twice and then abandoned.
 *
 * ## What it is careful about
 *
 * "Fixed" and "set aside" are counted SEPARATELY and never merged. A check
 * whose findings are all real but all describe a standing arrangement (so they
 * all get ruled on) is not the same as a check that is wrong, and a precision
 * number that conflated them would demote the wrong checks.
 *
 * A resolved finding that comes BACK is not hidden — `resolvedAt` is cleared
 * and `runsSeen` keeps climbing, because "we fixed this and it returned" is
 * exactly the thing worth being able to see.
 *
 * Every function is BEST-EFFORT: an unreachable companion DB costs the review
 * its memory, never the review itself.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewFindingState } from "@/db/schema";

import { checkIdForKind } from "./registry";
import type { Finding, FindingHistoryNote } from "./types";

/** What is known about one finding across the runs that have seen it. */
export interface FindingState {
  key: string;
  kind: string;
  checkId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  runsSeen: number;
  /** "" while it is still being found. */
  resolvedAt: string;
  wasSuppressed: boolean;
}

/**
 * Fold this run's findings into the month's memory.
 *
 * Three things happen, in one pass:
 *   • a finding seen for the first time gets a row, dated now;
 *   • a finding seen again has its last-seen and count moved on (and any
 *     previous `resolvedAt` cleared — it came back);
 *   • a finding that was open for this month and is NOT in this run is marked
 *     resolved, which is the signal that somebody fixed it.
 *
 * Returns the reason it could not be recorded, or "" — never throws.
 */
export async function recordFindings(
  ym: string,
  findings: Finding[],
  ranAt: string,
): Promise<string> {
  try {
    await ensureDb();

    const open = await db
      .select()
      .from(invoiceReviewFindingState)
      .where(and(eq(invoiceReviewFindingState.ym, ym), eq(invoiceReviewFindingState.resolvedAt, "")));
    const openByKey = new Map(open.map((r) => [r.key, r]));

    const seen = new Set<string>();
    for (const f of findings) {
      // A run can legitimately carry one key once; guard anyway, because a
      // duplicate would double-count `runsSeen` and skew every later number.
      if (seen.has(f.key)) continue;
      seen.add(f.key);

      const prior = openByKey.get(f.key);
      const common = {
        kind: f.kind,
        checkId: checkIdForKind(f.kind),
        jobId: f.jobId,
        severity: f.severity,
        amount: Math.abs(f.amount ?? 0),
        title: f.title.slice(0, 400),
        lastSeenAt: ranAt,
        // Judged at last sight: a ruling can be lifted, and the finding then
        // stops being "set aside" from that run on.
        wasSuppressed: Boolean(f.suppressedBy),
      };

      if (prior) {
        await db
          .update(invoiceReviewFindingState)
          .set({ ...common, runsSeen: prior.runsSeen + 1 })
          .where(eq(invoiceReviewFindingState.id, prior.id));
      } else {
        // Not in the OPEN set — but it may be a resolved row coming back, in
        // which case (ym, key) already exists and the insert must reopen it
        // rather than collide.
        await db
          .insert(invoiceReviewFindingState)
          .values({ ym, key: f.key, firstSeenAt: ranAt, runsSeen: 1, resolvedAt: "", ...common })
          .onConflictDoUpdate({
            target: [invoiceReviewFindingState.ym, invoiceReviewFindingState.key],
            set: { ...common, resolvedAt: "" },
          });
      }
    }

    // Anything open for this month that this run did not find has been dealt
    // with. That is the "fixed" signal, and the whole basis of precision.
    const gone = open.filter((r) => !seen.has(r.key)).map((r) => r.id);
    if (gone.length) {
      await db
        .update(invoiceReviewFindingState)
        .set({ resolvedAt: ranAt })
        .where(inArray(invoiceReviewFindingState.id, gone));
    }
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "unknown error";
  }
}

/** The month's finding memory, keyed by finding key. Empty when unavailable. */
export async function readFindingState(ym: string): Promise<Map<string, FindingState>> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewFindingState)
      .where(eq(invoiceReviewFindingState.ym, ym));
    return new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          kind: r.kind,
          checkId: r.checkId,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
          runsSeen: r.runsSeen,
          resolvedAt: r.resolvedAt,
          wasSuppressed: r.wasSuppressed,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/**
 * Stamp each finding with what the review remembers about it.
 *
 * Returns a new array; the input is untouched, so the raw check output stays
 * inspectable — the same rule `applyRulings` follows.
 *
 * MUST be called with state read BEFORE this run was recorded, or every finding
 * looks like one the review has already seen and nothing is ever new.
 */
export function attachHistory(
  findings: Finding[],
  state: Map<string, FindingState>,
  ranAt: string,
): Finding[] {
  if (!state.size) return findings;
  return findings.map((f) => {
    const prior = state.get(f.key);
    const history: FindingHistoryNote = prior
      ? {
          firstSeenAt: prior.firstSeenAt,
          // +1 for this run, which has not been recorded yet.
          runsSeen: prior.runsSeen + 1,
          isNew: false,
        }
      : { firstSeenAt: ranAt, runsSeen: 1, isNew: true };
    return { ...f, history };
  });
}

/** How one check has been doing, across every month on record. */
export interface CheckPrecision {
  checkId: string;
  /** Findings that stopped appearing with no ruling — somebody fixed them. */
  fixed: number;
  /** Findings the office explicitly set aside. */
  setAside: number;
  /** Still open, no ruling. No verdict yet — but a big number here on an old
   *  check means nobody is acting on it. */
  standing: number;
  /** fixed / (fixed + setAside), or null below `minSample` — a check with three
   *  findings to its name has no precision, it has anecdotes. */
  precision: number | null;
  /** fixed + setAside. The denominator, published so the number can be judged. */
  decided: number;
}

/** Below this many DECIDED findings, a precision figure is noise and is
 *  reported as null rather than as a confident-looking fraction. */
export const MIN_PRECISION_SAMPLE = 8;

/**
 * Per-check precision, derived from what the office did next.
 *
 * A check high in `setAside` is telling you something specific: it is finding
 * real, structural facts about how Ascent bills that the check cannot know
 * about. The answer is usually a wider ruling scope, sometimes a threshold, and
 * only occasionally that the check was wrong.
 */
export async function checkPrecision(): Promise<CheckPrecision[]> {
  try {
    await ensureDb();
    const rows = await db.select().from(invoiceReviewFindingState);
    const by = new Map<string, CheckPrecision>();
    for (const r of rows) {
      const id = r.checkId || `(${r.kind})`;
      const c =
        by.get(id) ??
        { checkId: id, fixed: 0, setAside: 0, standing: 0, precision: null, decided: 0 };
      if (r.wasSuppressed) c.setAside++;
      else if (r.resolvedAt) c.fixed++;
      else c.standing++;
      by.set(id, c);
    }
    return [...by.values()]
      .map((c) => {
        const decided = c.fixed + c.setAside;
        return {
          ...c,
          decided,
          precision: decided >= MIN_PRECISION_SAMPLE ? c.fixed / decided : null,
        };
      })
      .sort((a, b) => b.decided - a.decided);
  } catch {
    return [];
  }
}
