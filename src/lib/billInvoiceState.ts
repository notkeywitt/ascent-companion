/**
 * WHERE A BILL STANDS IN THE MONTHLY INVOICING LIFECYCLE — the single thing the
 * edge stripe down a bill row means.
 *
 * The stripe used to mean four unrelated things at once (flagged for review,
 * coding over budget, still a draft, already invoiced), which is why it could
 * not be read at scrolling speed: a red stripe answered "is this bill's coding
 * over budget" while the blue one beside it answered "has the client been
 * billed". Budget headroom, coding progress and paid state all have their own
 * chips on the row, so the stripe now answers ONE question — has this bill made
 * it onto the month's invoice.
 *
 *   needs-review  a correction the office has to make. Outranks everything:
 *                 it is the only state that is a task rather than a stage.
 *   reviewed      the bill card's "reviewed" toggle is on and the bill is still
 *                 a DRAFT in JobTread — coded and checked, awaiting approval.
 *   invoiced      out of draft AND on a customer invoice. Nothing to do.
 *   missing       an invoice exists for the job's month and this bill is NOT on
 *                 it. The alarm: finalized money left off the invoice.
 *   none          nothing to say yet — an unreviewed draft, or a finalized bill
 *                 in a month whose invoice has not been raised.
 *
 * `missing` rests on `monthInvoiceExists`, which the jobtread.ts readers derive
 * from the WHOLE month before dropping already-invoiced bills (see
 * `getJobBillsForMonth`). Derived from the visible rows instead, it could never
 * fire on a month whose invoice has gone out — the case it exists to catch.
 *
 * Lives in lib/, not beside the components that render it, so the branch order
 * is unit-testable without a React environment.
 */
export type BillInvoiceState = "needs-review" | "reviewed" | "invoiced" | "missing" | "none";

export interface BillInvoiceStateInput {
  needsReview?: boolean;
  reviewed?: boolean;
  /** JobTread document status: draft | pending | approved. */
  status?: string;
  /** On a customer invoice of any status but denied — see `_isOnAnyInvoice`. */
  onInvoice?: boolean;
  /** Does the bill's job have an invoice for the month at all? */
  monthInvoiceExists?: boolean;
}

export const billInvoiceState = (b: BillInvoiceStateInput): BillInvoiceState => {
  if (b.needsReview) return "needs-review";
  if (b.status === "draft") return b.reviewed ? "reviewed" : "none";
  if (b.onInvoice) return "invoiced";
  return b.monthInvoiceExists ? "missing" : "none";
};

/** The stripe colour per state. `needs-review` and `missing` share red on
 *  purpose — both mean "act on this" — and are told apart by the wider stripe
 *  every caller gives `needs-review`. */
export const BILL_STRIPE_COLOR: Record<BillInvoiceState, string> = {
  "needs-review": "bg-red-500",
  reviewed: "bg-sky-500",
  invoiced: "bg-emerald-500",
  missing: "bg-red-500",
  none: "bg-transparent",
};
