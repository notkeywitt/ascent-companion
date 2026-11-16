/**
 * Has the bill been paid? JobTread computes `amountPaid` and `balance` from
 * QuickBooks once a bill is approved (nothing in the Assistant writes them), so
 * they are the only honest paid signal — bill status is not one.
 *
 * Read the two TOGETHER. A draft bill reports amountPaid 0 AND balance 0
 * (confirmed against live bills 2026-09-01), so `balance === 0` on its own would
 * mark every draft paid. Money must have moved first, and only then does a zero
 * balance mean paid in full.
 *
 * Client-safe and server-safe (no React), so a route and a page share one rule.
 * `src/components/BillingSummary.tsx` re-exports it for the older importers.
 */
export type PaidState = "unpaid" | "partial" | "paid";
export const billPaidState = (b: { amountPaid?: number; balance?: number }): PaidState => {
  const paid = b.amountPaid ?? 0;
  if (Math.abs(paid) < 0.005) return "unpaid";
  return Math.abs(b.balance ?? 0) < 0.005 ? "paid" : "partial";
};
