/**
 * A client invoice's two states, as the Invoicing Package page shows them:
 * where the MONEY is (draft / open / part paid / paid / void) and where the
 * EMAIL is (not sent / sending / delivered / opened / bounced).
 *
 * Both come from JobTread (`getInvoiceStatuses` in `jobtread.ts`). The email
 * state is JobTread's own record of a document it emailed: each
 * `documentRecipient` carries an `emailDeliveryStatus` and the last time the
 * recipient viewed the document. An invoice sent from QuickBooks instead has
 * no emailed recipient, so JobTread cannot say whether it went out — the page
 * says "not sent from JobTread" rather than "not sent".
 */

/** One recipient, as JobTread holds it. */
export interface InvoiceRecipientRaw {
  name: string;
  /** null = added to the document but never emailed. */
  emailDeliveryStatus: string | null;
  emailDeliveryStatusUpdatedAt: string | null;
  documentLastViewedAt: string | null;
}

/** One client invoice, as JobTread holds it. */
export interface InvoiceRaw {
  status: string;
  priceWithTax: number;
  amountPaid: number;
  balance: number;
  qboId: string | null;
  recipients: InvoiceRecipientRaw[];
}

export type PaymentState = "draft" | "open" | "partPaid" | "paid" | "void";
export type DeliveryState = "notSent" | "sending" | "delivered" | "opened" | "bounced";

export interface InvoiceStatus {
  payment: PaymentState;
  amountPaid: number;
  balance: number;
  delivery: DeliveryState;
  /** Names of the recipients JobTread emailed. */
  sentTo: string[];
  /** Latest delivery-status change among them (ISO), or "". */
  deliveryAt: string;
  /** Latest time any recipient viewed the invoice (ISO), or "". */
  viewedAt: string;
  /** A recipient's email bounced, even if another one got through. */
  bounced: boolean;
  /** The invoice is synced to QuickBooks. */
  inQbo: boolean;
}

/** Half a cent: a balance under this is paid. */
const EPS = 0.005;

export function paymentState(inv: Pick<InvoiceRaw, "status" | "amountPaid" | "balance">): PaymentState {
  if (inv.status === "denied") return "void";
  if (inv.status === "draft") return "draft";
  if (inv.balance <= EPS && (inv.status === "approved" || inv.amountPaid > EPS)) return "paid";
  if (inv.amountPaid > EPS) return "partPaid";
  return "open";
}

/** Rank of a delivery state: the best one across recipients wins. */
const RANK: Record<DeliveryState, number> = { notSent: 0, bounced: 1, sending: 2, delivered: 3, opened: 4 };

function recipientState(r: InvoiceRecipientRaw): DeliveryState {
  if (r.documentLastViewedAt) return "opened";
  switch (r.emailDeliveryStatus) {
    case "opened":
      return "opened";
    case "delivered":
      return "delivered";
    case "pending":
      return "sending";
    case "softBounced":
    case "hardBounced":
      return "bounced";
    default:
      return "notSent";
  }
}

const latest = (xs: (string | null)[]) =>
  xs.reduce<string>((best, x) => (x && x > best ? x : best), "");

export function invoiceStatus(inv: InvoiceRaw): InvoiceStatus {
  const emailed = inv.recipients.filter((r) => r.emailDeliveryStatus || r.documentLastViewedAt);
  const states = emailed.map(recipientState);
  const delivery = states.reduce<DeliveryState>((best, s) => (RANK[s] > RANK[best] ? s : best), "notSent");
  return {
    payment: paymentState(inv),
    amountPaid: inv.amountPaid,
    balance: inv.balance,
    delivery,
    sentTo: emailed.map((r) => r.name).filter(Boolean),
    deliveryAt: latest(emailed.map((r) => r.emailDeliveryStatusUpdatedAt)),
    viewedAt: latest(emailed.map((r) => r.documentLastViewedAt)),
    bounced: states.includes("bounced"),
    inQbo: !!inv.qboId,
  };
}

export const PAYMENT_LABEL: Record<PaymentState, string> = {
  draft: "Draft",
  open: "Open",
  partPaid: "Part paid",
  paid: "Paid",
  void: "Void",
};

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  notSent: "Not sent from JobTread",
  sending: "Sending",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
};
