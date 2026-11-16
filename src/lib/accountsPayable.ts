/**
 * ACCOUNTS PAYABLE — the month's vendor bills and whether each one is paid.
 *
 * Pure, client-safe. The route (`/api/accounts-payable`) reads the month with
 * `getAllBillsForMonth` and hands the rows here.
 *
 * What is LEFT OUT, and why:
 *   - Sunset Builders Supply. It is paid in bulk off its monthly statement
 *     (the Sunset Statements tab), not bill by bill.
 *   - Expenses (`isExpense` — the Bill/Expense toggle). An Expense is paid at
 *     purchase, on the card or from the bank, so nothing is owed on it.
 *
 * Paid or not is JobTread's own figure, read from QuickBooks (`billPaidState`).
 * "Owed" is cost − amountPaid, not `balance`: a draft reads balance 0 before it
 * reaches QuickBooks, and it is still owed.
 */
import { billPaidState, type PaidState } from "@/lib/billPaid";

export interface PayableInput {
  id: string;
  vendor: string;
  cost: number;
  issueDate: string;
  status: string;
  amountPaid: number;
  balance: number;
  isExpense: boolean;
  jobId: string;
  jobName: string;
  customerName: string;
}

export interface Payable extends PayableInput {
  paid: PaidState;
  /** Still owed: cost − amountPaid. 0 on a paid bill. */
  owed: number;
}

export interface PayablesSummary {
  bills: Payable[];
  total: number;
  owed: number;
  paidCount: number;
  unpaidCount: number;
  /** How many bills each exclusion took out, so the page can say so. */
  sunsetLeftOut: number;
  expensesLeftOut: number;
}

/** Sunset Builders Supply, by name — the list carries no vendor id. */
export const isSunsetName = (vendor: string) => /sunset builders/i.test(vendor);

const ORDER: Record<PaidState, number> = { unpaid: 0, partial: 1, paid: 2 };

export function buildPayables(rows: PayableInput[]): PayablesSummary {
  let sunsetLeftOut = 0;
  let expensesLeftOut = 0;
  const bills: Payable[] = [];
  for (const r of rows) {
    if (isSunsetName(r.vendor)) {
      sunsetLeftOut++;
      continue;
    }
    if (r.isExpense) {
      expensesLeftOut++;
      continue;
    }
    const paid = billPaidState(r);
    const owed = paid === "paid" ? 0 : Math.round((r.cost - r.amountPaid) * 100) / 100;
    bills.push({ ...r, paid, owed });
  }
  // Unpaid first, then part-paid, then paid; vendor A–Z inside each.
  bills.sort(
    (a, b) =>
      ORDER[a.paid] - ORDER[b.paid] ||
      a.vendor.localeCompare(b.vendor) ||
      b.cost - a.cost,
  );
  const sum = (f: (b: Payable) => number) => Math.round(bills.reduce((s, b) => s + f(b), 0) * 100) / 100;
  return {
    bills,
    total: sum((b) => b.cost),
    owed: sum((b) => b.owed),
    paidCount: bills.filter((b) => b.paid === "paid").length,
    unpaidCount: bills.filter((b) => b.paid !== "paid").length,
    sunsetLeftOut,
    expensesLeftOut,
  };
}
