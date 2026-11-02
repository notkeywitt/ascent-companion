/**
 * Sunset statement line → bill links (the "Link" on /payments). Pure, so the
 * route, the page and the tests agree on one line identity.
 *
 * `sunsetLineKey` MUST match `_sunreconNormNum` in ascent-appscript
 * SunsetPayments.js: uppercase, drop every non-alphanumeric character, drop
 * leading zeros. The reconcile finds a link by this key, so a drift here makes
 * a saved link silently stop applying.
 */
export function sunsetLineKey(v: unknown): string {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.replace(/^0+(?=[0-9])/, "");
}

export const sunsetLinkId = (statementExpId: string, lineNumber: string) =>
  `${statementExpId.trim()}|${sunsetLineKey(lineNumber)}`;

/** A bill of the statement's month, as the reconcile offers it to the picker. */
export interface SunsetCandidate {
  uid: string;
  number: string;
  amount: number;
  isCredit: boolean;
  date: string;
  docId: string;
  jobId: string;
  jobName: string;
  claimedBy: { statementId: string; line: string } | null;
}

/**
 * The picker's order for one statement line: unclaimed bills first, then the
 * closest amount, then the same date. A typed query filters on the invoice
 * number, the job name or the amount.
 */
export function rankCandidates(
  list: SunsetCandidate[],
  line: { amount: number; date?: string },
  query = "",
): SunsetCandidate[] {
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/[^0-9.]/g, "");
  const hit = (c: SunsetCandidate) =>
    !q ||
    c.number.toLowerCase().includes(q) ||
    c.jobName.toLowerCase().includes(q) ||
    (qDigits !== "" && c.amount.toFixed(2).includes(qDigits));
  const d = (line.date ?? "").slice(0, 10);
  return list
    .filter(hit)
    .map((c) => ({
      c,
      k: [
        c.claimedBy ? 1 : 0,
        Math.round(Math.abs(c.amount - line.amount) * 100),
        d && c.date.slice(0, 10) === d ? 0 : 1,
      ],
    }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
    .map((x) => x.c);
}
