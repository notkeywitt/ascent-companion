/**
 * The Sunset Statements page's month: which statements Approve all and Print
 * act on, and what a statement's Office-job bill says about payment. PURE: the
 * page, the routes and the test import it.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10" from a statement date ("2026-10-31", or the "2026-10" fallback). "" when unusable. */
export function statementMonthKey(statementDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(statementDate ?? "").trim());
  if (!m) return "";
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : "";
}

/** "October 2026" for "2026-10". */
export function monthKeyLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : key;
}

/** Paid in full in JobTread — the same test as billPaidState: money applied, nothing owed. */
export function statementBillPaid(b: { amountPaid: number; balance: number; status?: string }): boolean {
  if (b.status === "denied") return false;
  return Math.abs(b.amountPaid) >= 0.005 && Math.abs(b.balance) < 0.005;
}

/** What Approve sets: a Bill is a payable (pending), an Expense is already paid (approved).
 *  The same rule as useBillApproval's approvalTarget. */
export const approvalStatusFor = (name: string): "pending" | "approved" =>
  name === "Expense" ? "approved" : "pending";
