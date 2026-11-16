/**
 * BILL CLONES — the pure rules behind the Bill Clones page (/bill-clone).
 *
 * The owner re-files a vendor's month of Expenses as Bills (2026-11-16): each
 * Expense is copied to a new draft document, the copy becomes a Bill, the copy
 * is approved (which pushes it to QuickBooks as a Bill), and the old Expense is
 * voided. The old Expense is deleted or voided in QuickBooks by hand.
 *
 * A clone is found by its externalId: the original's plus "-B". The appscript
 * mirror keys on externalId, so two live bills must never share one.
 */

export const CLONE_SUFFIX = "-B";

/** The externalId a clone of this document carries. Inside JobTread's 32. */
export function cloneExternalId(original: { id: string; externalId?: string | null }): string {
  const base = (original.externalId ?? "").trim() || original.id;
  return `${base.slice(0, 32 - CLONE_SUFFIX.length)}${CLONE_SUFFIX}`;
}

export const isCloneExternalId = (externalId?: string | null) =>
  (externalId ?? "").trim().endsWith(CLONE_SUFFIX);

/** A vendor document as the page lists it. */
export interface CloneDoc {
  id: string;
  jobId: string;
  jobName: string;
  number: string;
  externalId: string;
  issueDate: string;
  cost: number;
  name: string;
  status: string;
  qboDocumentType: string;
  qboId: string;
}

/** An Expense to re-file: a live, positive Push-as-Expense document. */
export function isCloneSource(d: CloneDoc): boolean {
  return (
    d.status !== "denied" &&
    !isCloneExternalId(d.externalId) &&
    !/^STMT-/i.test(d.externalId) &&
    d.cost >= 0 &&
    (d.qboDocumentType === "purchase" || (d.name === "Expense" && d.qboDocumentType !== "creditCardCredit"))
  );
}

/** Where a pair stands, in the order the four buttons move it. */
export type PairStage = "no clone" | "cloned" | "bill" | "approved" | "done";

export interface ClonePair {
  original: CloneDoc;
  clone: CloneDoc | null;
  stage: PairStage;
  /** What differs between the two, besides the Bill/Expense type. Empty = a match. */
  differences: string[];
}

export interface ClonePlan {
  pairs: ClonePair[];
  /** Clones with no live original in the month — extras, to look at. */
  extraClones: CloneDoc[];
  /** Live documents left alone: credits, statement bills, anything not an Expense. */
  skipped: CloneDoc[];
}

const money = (n: number) => Math.round(n * 100) / 100;

export const isBillDoc = (d: CloneDoc) => d.name === "Bill" && d.qboDocumentType === "bill";

export function pairStage(original: CloneDoc, clone: CloneDoc | null): PairStage {
  if (!clone) return "no clone";
  if (!isBillDoc(clone)) return "cloned";
  if (clone.status === "draft") return "bill";
  if (original.status !== "denied") return "approved";
  return "done";
}

export function compareClone(original: CloneDoc, clone: CloneDoc): string[] {
  const out: string[] = [];
  if (money(original.cost) !== money(clone.cost)) out.push(`amount ${original.cost} vs ${clone.cost}`);
  if (original.jobId !== clone.jobId) out.push("job");
  if (original.issueDate !== clone.issueDate) out.push("issue date");
  return out;
}

/**
 * Pair each Expense with its clone. A clone pairs with the original whose
 * cloneExternalId it carries; when two originals share one externalId (an old
 * re-file), the clone's job breaks the tie. Voided originals still pair, so a
 * finished pair stays on the table.
 */
export function planClones(docs: CloneDoc[]): ClonePlan {
  const clones = docs.filter((d) => isCloneExternalId(d.externalId) && d.status !== "denied");
  const used = new Set<string>();
  const pairs: ClonePair[] = [];
  const skipped: CloneDoc[] = [];

  // An original is a source now, or a voided Expense that a clone points at.
  const cloneKeys = new Set(clones.map((c) => c.externalId.trim()));
  for (const d of docs) {
    if (isCloneExternalId(d.externalId)) continue;
    const key = cloneExternalId(d);
    const voidedWithClone =
      d.status === "denied" && cloneKeys.has(key) && isCloneSource({ ...d, status: "approved" });
    if (!isCloneSource(d) && !voidedWithClone) {
      if (d.status !== "denied") skipped.push(d);
      continue;
    }
    const candidates = clones.filter((c) => !used.has(c.id) && c.externalId.trim() === key);
    const clone = candidates.find((c) => c.jobId === d.jobId) ?? candidates[0] ?? null;
    if (clone) used.add(clone.id);
    pairs.push({
      original: d,
      clone,
      stage: pairStage(d, clone),
      differences: clone ? compareClone(d, clone) : [],
    });
  }
  // A voided original without a clone is not ours to show.
  const kept = pairs.filter((p) => p.original.status !== "denied" || p.clone);
  kept.sort(
    (a, b) =>
      a.original.issueDate.localeCompare(b.original.issueDate) ||
      a.original.externalId.localeCompare(b.original.externalId),
  );
  return { pairs: kept, extraClones: clones.filter((c) => !used.has(c.id)), skipped };
}

/** "2026-10" → its first and last day. */
export function monthRange(ym: string): { first: string; last: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { first: `${ym}-01`, last: `${ym}-${String(days).padStart(2, "0")}` };
}

/** One printed line of a vendor statement, for the double-check. */
export interface StatementLine {
  number: string;
  amount: number;
  statement: string;
}

export type StatementVerdict = "match" | "amount differs" | "not on statement";

/** Normalise an invoice number the way statements and externalIds can both print it. */
export const invoiceKey = (s: string) => s.trim().replace(/^0+/, "").toUpperCase();

/**
 * Check each clone against the month's statement lines, by invoice number (the
 * original's externalId) and amount. Returns the verdict per clone id, and the
 * statement lines no clone accounts for.
 */
export function checkAgainstStatements(
  pairs: ClonePair[],
  lines: StatementLine[],
): { byCloneId: Record<string, { verdict: StatementVerdict; statementAmount?: number }>; unmatched: StatementLine[] } {
  const byKey = new Map<string, StatementLine[]>();
  for (const l of lines) {
    const k = invoiceKey(l.number);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(l);
  }
  const usedLines = new Set<StatementLine>();
  const byCloneId: Record<string, { verdict: StatementVerdict; statementAmount?: number }> = {};
  for (const p of pairs) {
    if (!p.clone) continue;
    const found = (byKey.get(invoiceKey(p.original.externalId)) ?? []).filter((l) => !usedLines.has(l));
    if (found.length === 0) {
      byCloneId[p.clone.id] = { verdict: "not on statement" };
      continue;
    }
    const exact = found.find((l) => money(l.amount) === money(p.clone!.cost)) ?? found[0];
    usedLines.add(exact);
    byCloneId[p.clone.id] = {
      verdict: money(exact.amount) === money(p.clone.cost) ? "match" : "amount differs",
      statementAmount: exact.amount,
    };
  }
  return { byCloneId, unmatched: lines.filter((l) => !usedLines.has(l)) };
}
