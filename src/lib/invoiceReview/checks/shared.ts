/**
 * Helpers shared by more than one check — name comparison, and the backup
 * pairing algorithm.
 *
 * Anything used by exactly ONE check belongs in that check's file. This is for
 * the parts two checks would otherwise each own a copy of, which is how two
 * checks start quietly disagreeing about whether two things are the same thing.
 *
 * Pure. Nothing here fetches, writes, or reads a clock.
 */
import { cents, withinTolerance, type BackupFile, type BillRef } from "../types";

/** Words that carry no identity in a vendor name, so they must not create a match. */
const NOISE_TOKENS = new Set([
  "llc", "inc", "co", "corp", "ltd", "the", "and", "of", "company", "supply",
  "services", "service", "pushed", "to", "jt", "pdf",
]);

/** Comparable tokens from a name — lowercase, punctuation dropped, noise removed. */
export function tokens(s: string): Set<string> {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length >= 3 && !NOISE_TOKENS.has(t)),
  );
}

/** How many identity tokens two names share. */
export function overlap(a: string, b: string): number {
  const ta = tokens(a);
  let n = 0;
  for (const t of tokens(b)) if (ta.has(t)) n++;
  return n;
}

/** A backup filename with Drive's collision suffix stripped: "x (2)" → "x". */
export function dedupeName(tail: string): string {
  return String(tail ?? "").replace(/\s*\(\d+\)\s*$/, "").trim().toLowerCase();
}

/**
 * A link to the Assistant's own bill page.
 *
 * Always append `jobId` when we have it: `/bill/[docId]` reads the doc id from
 * the path but the job id from the query string, and the job powers the page's
 * coding-queue pager, Back link and neighbour prefetch. It is no longer strictly
 * required — `/api/bill` recovers the job from the bill itself when the query
 * param is missing (so a link built with an empty jobId still opens the bill) —
 * but passing it avoids the extra lookup and keeps the pager working on arrival.
 */
export function billLink(jobId: string, billId: string): string {
  const doc = `/bill/${encodeURIComponent(billId)}`;
  return jobId ? `${doc}?jobId=${encodeURIComponent(jobId)}` : doc;
}

export interface BackupMatch {
  /** Bills on a live invoice with no backup PDF filed. */
  unmatchedBills: BillRef[];
  /** Coded backup PDFs that no bill on the invoice accounts for. */
  unmatchedFiles: BackupFile[];
  /** bill id → the file matched to it. */
  matched: Map<string, BackupFile>;
}

/**
 * Pair each invoiced vendor bill with the backup PDF filed for it.
 *
 * The pairing key is the AMOUNT, because that is the one field both sides state
 * exactly: the Drive filename carries the summed coded amounts
 * ("06 42 00 - $316.80 _ 01 71 13 - $10.00 - …"), which the ingestion pipeline
 * builds from the same line items that became the bill's cost. Vendor name only
 * breaks ties — it is spelled differently on the two sides often enough that
 * matching on it first would strand real pairs.
 *
 * Matching is one-to-one and consuming, so the month's two separate $7.99
 * Sunset tickets pair with the two separate $7.99 PDFs instead of both latching
 * onto the first one. Bills are taken largest-first so the pairs that matter
 * most are resolved before the small change.
 *
 * Only PDFs the Apps Script half could PARSE take part. A Sunset statement or a
 * dropped photo has no coded amount, so it is neither a candidate nor reported
 * as unaccounted-for — it simply is not bill backup.
 */
export function matchBackup(
  bills: BillRef[],
  files: BackupFile[],
  /** At or below this, two amounts are the same amount. The configured value is
   *  `tolerance` in settings.ts; the default here matches it so the function
   *  stays callable on its own (it is unit-tested directly). Compared in whole
   *  cents by `withinTolerance` — a bill and its backup filename round in a
   *  different ORDER and legitimately land a cent apart. */
  tolerance = 0.01,
): BackupMatch {
  const parsed = files.filter((f) => f.parsed);
  const taken = new Set<string>();
  const matched = new Map<string, BackupFile>();
  const unmatchedBills: BillRef[] = [];

  const byCost = [...bills].sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));
  for (const bill of byCost) {
    const want = cents(bill.cost);
    let best: BackupFile | null = null;
    let bestScore = -1;
    for (const f of parsed) {
      if (taken.has(f.id)) continue;
      if (!withinTolerance(f.amount, want, tolerance)) continue;
      const score = overlap(f.tail, bill.vendor || bill.label);
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    }
    if (best) {
      taken.add(best.id);
      matched.set(bill.id, best);
    } else {
      unmatchedBills.push(bill);
    }
  }

  return {
    unmatchedBills,
    unmatchedFiles: parsed.filter((f) => !taken.has(f.id)),
    matched,
  };
}
