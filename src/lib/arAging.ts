/**
 * ACCOUNTS RECEIVABLE AGEING — what clients owe, and for how long.
 *
 * ── WHY THIS IS A PAGE AND NOT A REPORT ─────────────────────────────────────
 * JobTread already holds every number here: a `customerInvoice` carries
 * `priceWithTax`, `amountPaid` (computed from QuickBooks) and `balance`. The
 * app has been reading `amountPaid` for months, on the bill page and in the
 * invoice review. Nothing has ever shown it. So the one question a builder asks
 * every week — who owes us money, and is it late — had no answer inside the app
 * that field staff and the office already live in.
 *
 * ── THE ONE RULE WORTH ARGUING ABOUT ────────────────────────────────────────
 * An invoice ages from its DUE DATE where it has one, and from its ISSUE DATE
 * where it does not. Not from whichever is later, and not always from the issue
 * date:
 *
 *   • Ageing from the issue date on an invoice with net-30 terms reports it 30
 *     days late the moment it is sent. Every invoice looks overdue, so none do.
 *   • Ageing from the due date on an invoice that has none would need a term
 *     invented for it, and an invented term is a made-up figure in a money
 *     report.
 *
 * `basis` is carried on every row so the page can say which of the two it used.
 * A report that hides that is one nobody can reconcile against QuickBooks.
 *
 * Pure module: no DB, no JobTread, no React. Everything here is arithmetic over
 * rows the caller already fetched, which is what makes the buckets testable.
 */

/** One unpaid (or part-paid) client invoice, reduced to what ageing needs. */
export interface ArInvoice {
  id: string;
  /** JobTread's document number, as text. */
  number: string;
  status: string;
  jobId: string;
  jobName: string;
  customerName: string;
  /** "YYYY-MM-DD". */
  issueDate: string;
  /** "YYYY-MM-DD", or "" when the invoice carries no due date. */
  dueDate: string;
  /** Billed to the customer, including tax — the figure the client sees. */
  total: number;
  /** Recorded against it, from QuickBooks. */
  amountPaid: number;
  /** Still owed, as JobTread states it. READ, never recomputed here. */
  balance: number;
  jtUrl: string;
}

/** An ageing row: one invoice, plus how old it is and why. */
export interface ArAgedInvoice extends ArInvoice {
  /** Days past the date it ages from. Negative means not yet due. */
  daysOverdue: number;
  /** Which date it aged from — see the module note. */
  basis: "due" | "issue";
  /** The date it aged from, "YYYY-MM-DD". */
  basisDate: string;
  bucket: ArBucketId;
}

/**
 * The ageing buckets.
 *
 * The 30/60/90 split is the convention every accountant, factor and bank
 * already reads, so it is not worth inventing a different one. "Current"
 * carries anything not yet past its date, including invoices sent today.
 */
export type ArBucketId = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AR_BUCKETS: { id: ArBucketId; label: string; short: string }[] = [
  { id: "current", label: "Not yet due", short: "Current" },
  { id: "d1_30", label: "1–30 days late", short: "1–30" },
  { id: "d31_60", label: "31–60 days late", short: "31–60" },
  { id: "d61_90", label: "61–90 days late", short: "61–90" },
  { id: "d90_plus", label: "Over 90 days late", short: "90+" },
];

/** Which bucket a number of days past due falls in. */
export function bucketFor(daysOverdue: number): ArBucketId {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

/**
 * Whole days between two calendar dates, as UTC midnights.
 *
 * Deliberately date arithmetic rather than timestamp arithmetic: an invoice is
 * due ON a day, not at an instant, and subtracting local timestamps makes a
 * bill flip a bucket at 5pm Pacific. Returns null for anything unparseable, so
 * a malformed date is skipped rather than silently aged from the epoch.
 */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Money, rounded to the cent — the only rounding this module does. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Age one invoice as at `today` ("YYYY-MM-DD").
 *
 * Returns null when the invoice has no date this can work from, which is the
 * honest answer: an un-ageable invoice belongs in the caller's "cannot age"
 * list, not in a bucket chosen for it.
 */
export function ageInvoice(inv: ArInvoice, today: string): ArAgedInvoice | null {
  const basis: "due" | "issue" = inv.dueDate ? "due" : "issue";
  const basisDate = (basis === "due" ? inv.dueDate : inv.issueDate).slice(0, 10);
  const days = basisDate ? daysBetween(basisDate, today) : null;
  if (days === null) return null;
  return { ...inv, daysOverdue: days, basis, basisDate, bucket: bucketFor(days) };
}

/** One bucket's totals. */
export interface ArBucketTotal {
  id: ArBucketId;
  label: string;
  short: string;
  count: number;
  amount: number;
}

/** One customer's outstanding balance, split by bucket. */
export interface ArCustomerTotal {
  customerName: string;
  amount: number;
  count: number;
  /** The oldest days-overdue among this customer's invoices. */
  worstDaysOverdue: number;
  byBucket: Record<ArBucketId, number>;
}

export interface ArAgingSummary {
  /** "YYYY-MM-DD" the ageing was computed as at. */
  asOf: string;
  /** Every ageable invoice with a balance, oldest first. */
  invoices: ArAgedInvoice[];
  /** Invoices with a balance that carry no usable date at all. */
  unageable: ArInvoice[];
  buckets: ArBucketTotal[];
  customers: ArCustomerTotal[];
  /** Everything outstanding. */
  totalOutstanding: number;
  /** Everything past its date — the number that actually matters. */
  totalOverdue: number;
  invoiceCount: number;
}

/**
 * The smallest balance worth listing.
 *
 * A cent or two of rounding between JobTread and QuickBooks is not a
 * receivable, and a page full of $0.01 rows is a page nobody opens.
 */
export const BALANCE_FLOOR = 0.5;

/**
 * Build the ageing.
 *
 * `today` is passed in rather than read from the clock so the whole thing is a
 * pure function of its inputs — which is what lets the buckets be tested at a
 * boundary instead of near one.
 */
export function buildArAging(rows: ArInvoice[], today: string): ArAgingSummary {
  const owing = rows.filter((r) => r.balance > BALANCE_FLOOR);

  const invoices: ArAgedInvoice[] = [];
  const unageable: ArInvoice[] = [];
  for (const inv of owing) {
    const aged = ageInvoice(inv, today);
    if (aged) invoices.push(aged);
    else unageable.push(inv);
  }

  // Oldest first: the top of this list is the collection call to make today.
  invoices.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);

  const buckets: ArBucketTotal[] = AR_BUCKETS.map((b) => {
    const rowsIn = invoices.filter((i) => i.bucket === b.id);
    return {
      id: b.id,
      label: b.label,
      short: b.short,
      count: rowsIn.length,
      amount: cents(rowsIn.reduce((s, i) => s + i.balance, 0)),
    };
  });

  const byCustomer = new Map<string, ArCustomerTotal>();
  for (const inv of invoices) {
    // An invoice with no customer on it still owes money, so it gets a row
    // rather than being dropped into another customer's total.
    const key = inv.customerName || "(no customer)";
    let row = byCustomer.get(key);
    if (!row) {
      byCustomer.set(
        key,
        (row = {
          customerName: key,
          amount: 0,
          count: 0,
          worstDaysOverdue: inv.daysOverdue,
          byBucket: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
        }),
      );
    }
    row.amount = cents(row.amount + inv.balance);
    row.count += 1;
    row.worstDaysOverdue = Math.max(row.worstDaysOverdue, inv.daysOverdue);
    row.byBucket[inv.bucket] = cents(row.byBucket[inv.bucket] + inv.balance);
  }

  const customers = [...byCustomer.values()].sort(
    (a, b) => b.worstDaysOverdue - a.worstDaysOverdue || b.amount - a.amount,
  );

  // `unageable` counts toward what is outstanding — the money is owed whether or
  // not it can be aged — but never toward what is overdue, which would be a
  // claim the dates do not support.
  const totalOutstanding = cents(
    invoices.reduce((s, i) => s + i.balance, 0) + unageable.reduce((s, i) => s + i.balance, 0),
  );
  const totalOverdue = cents(
    invoices.filter((i) => i.daysOverdue > 0).reduce((s, i) => s + i.balance, 0),
  );

  return {
    asOf: today.slice(0, 10),
    invoices,
    unageable,
    buckets,
    customers,
    totalOutstanding,
    totalOverdue,
    invoiceCount: invoices.length + unageable.length,
  };
}
