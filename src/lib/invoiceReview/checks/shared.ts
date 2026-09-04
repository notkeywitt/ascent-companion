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

/**
 * How far apart a bill's cost and its backup filename's total may legitimately
 * be, in dollars.
 *
 * The two sides round in a different ORDER, and neither is wrong:
 *
 *   JobTread  rounds EACH LINE to cents, then sums them  -> the bill's cost
 *   filename  sums per CSI GROUP, rounds each group      -> the filename total
 *              (`_formatAggCsi`, Sheets_AppSheet.js)
 *
 * Every rounded sum can be out by at most half a cent, so the gap is bounded by
 * half a cent per line plus half a cent per CSI group. That is a bound, not a
 * guess: `ceil((lines + groups) / 2)` cents, computed as integers.
 *
 * Berger Main House proved it real — Island Custom Woodworks, 9 lines in 1
 * group, $4,163.75 in JobTread against `12 30 00 - $4163.74` on the PDF. The
 * bound allows 5 cents there and the actual drift was 1.
 *
 * A single-line bill lands on exactly 1 cent, which is what the flat tolerance
 * already gave it — so the common case does not loosen at all. That matters:
 * pairing is one-to-one and consuming, and only UNMATCHED bills are reported,
 * so a window wider than the real drift buys nothing and costs accuracy. A bill
 * could pair with a neighbour's PDF and its own missing backup would go
 * unreported. Widening is a false-negative risk, which is why this is derived
 * from the bill's shape instead of set to a round number.
 *
 * `lineCount: 0` means JobTread's count could not be read, so it falls back to
 * `globalTolerance` and widens nothing.
 */
export function backupTolerance(
  bill: BillRef,
  file: BackupFile,
  globalTolerance: number,
): number {
  if (!bill.lineCount) return globalTolerance;
  const rounded = bill.lineCount + Math.max(1, file.csi.length);
  const boundCents = Math.ceil(rounded / 2);
  return Math.max(globalTolerance, boundCents / 100);
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
  /** The FLOOR on how far apart two amounts may be and still be the same
   *  amount. The configured value is `tolerance` in settings.ts; the default
   *  here matches it so the function stays callable on its own (it is
   *  unit-tested directly). Each pair then gets its own allowance from
   *  `backupTolerance`, which is never tighter than this. */
  tolerance = 0.01,
): BackupMatch {
  const parsed = files.filter((f) => f.parsed);
  const taken = new Set<string>();
  const matched = new Map<string, BackupFile>();
  const unmatchedBills: BillRef[] = [];

  const byCost = [...bills].sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));
  for (const bill of byCost) {
    // TWO figures can legitimately be the filename's total, and which one
    // depends on whether the bill carries tax:
    //
    //   cost               — a bill with no tax, and any bill whose lines were
    //                        never grossed up (older captures)
    //   cost - taxAmount   — the normal taxed case. `cost` is TAX-INCLUSIVE
    //                        (_jtGrossUpLineCostsForTax grosses each line from
    //                        the receipt's pre-tax face value before pushing,
    //                        because JobTread stores unitCost tax-inclusive),
    //                        while the filename is built from the SHEET's
    //                        pre-tax amounts.
    //
    // Berger Bunkhouse, July 2026 proved both live: JR Granite matched at cost
    // ($11,030, no tax) while Fasteners Plus ($574.03 vs a $529.79 filename,
    // $44.24 of tax) and Home Depot ($59.50 vs $55.24) only match de-taxed.
    // Comparing cost alone reported seven bills as having no backup filed AND
    // the very PDFs backing them as billed to nobody — both halves of every
    // pair wrong.
    //
    // Accepting either is safe: pairing is one-to-one and consuming, and only
    // UNMATCHED bills are reported, so a second valid candidate can only
    // resolve a pair that is genuinely the same charge.
    const wants = [cents(bill.cost)];
    if (bill.taxAmount) wants.push(cents(bill.cost - bill.taxAmount));
    let best: BackupFile | null = null;
    let bestScore = -1;
    for (const f of parsed) {
      if (taken.has(f.id)) continue;
      const tol = backupTolerance(bill, f, tolerance);
      if (!wants.some((want) => withinTolerance(f.amount, want, tol))) continue;
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
