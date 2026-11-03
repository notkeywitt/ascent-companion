/**
 * WHERE A BILL STANDS IN THE MONTHLY INVOICING LIFECYCLE — the single thing the
 * edge stripe down a bill row means. The owner's colour code (2026-11-03):
 *
 *   needs-review  YELLOW. A correction the office has to make. Outranks
 *                 everything: it is the only state that is a task, not a stage.
 *   approved      LIGHT BLUE. JobTread status `approved` and NOT yet on a
 *                 customer invoice.
 *   invoiced      BLUE. On a customer invoice, and the bill is not paid in full.
 *   paid          GREEN. On a customer invoice AND paid in full.
 *   none          No stripe — a draft, or a pending bill not on an invoice.
 *
 * "Paid" is the caller's `billPaidState(b) === "paid"` (BillingSummary.tsx), the
 * QuickBooks amountPaid/balance pair read together. It is passed in as a flag so
 * this file stays free of component imports and unit-testable.
 *
 * A draft gets no stripe even when it sits on a draft invoice: it is not final.
 */
export type BillInvoiceState = "needs-review" | "approved" | "invoiced" | "paid" | "none";

export interface BillInvoiceStateInput {
  needsReview?: boolean;
  /** JobTread document status: draft | pending | approved. */
  status?: string;
  /** On a customer invoice of any status but denied — see `_isOnAnyInvoice`. */
  onInvoice?: boolean;
  /** Paid in full in QuickBooks — `billPaidState(b) === "paid"`. */
  paid?: boolean;
}

export const billInvoiceState = (b: BillInvoiceStateInput): BillInvoiceState => {
  if (b.needsReview) return "needs-review";
  if (b.status === "draft") return "none";
  if (b.onInvoice) return b.paid ? "paid" : "invoiced";
  return b.status === "approved" ? "approved" : "none";
};

/** The stripe colour per state. Every caller also widens the `needs-review`
 *  stripe, so the one task state reads before the stages around it. */
export const BILL_STRIPE_COLOR: Record<BillInvoiceState, string> = {
  "needs-review": "bg-yellow-400",
  approved: "bg-sky-300",
  invoiced: "bg-blue-600",
  paid: "bg-emerald-500",
  none: "bg-transparent",
};
