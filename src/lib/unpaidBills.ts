/**
 * UNPAID BILLS — Home's Unpaid bills widget. Every Bill still unpaid or part
 * paid, newest to oldest. Expenses are left out (owner, 2026-11-20): it is a
 * bills list, and an Expense is paid at purchase.
 *
 * Pure, client-safe. The read is `getUnpaidBillsSince` (lib/jobtread); the
 * route is `/api/accounts-payable/unpaid`.
 *
 * Bills dated before `UNPAID_BILLS_FROM` are left out (owner, 2026-11-20):
 * older bills entered in JobTread read unpaid, but they were paid. Voided bills (status `denied`) never reach here: the read asks for
 * draft, pending and approved only.
 *
 * Paid or not is `billPaidState` (JobTread's figure from QuickBooks). Owed is
 * cost − amountPaid, as on Accounts Payable: a draft reads balance 0 and is
 * still owed.
 *
 * Sunset Builders Supply is left out (owner, 2026-11-20): it is paid off its
 * monthly statement, not bill by bill (the same rule as Accounts Payable).
 */
import { billPaidState, type PaidState } from "@/lib/billPaid";
import { isSunsetName } from "@/lib/accountsPayable";

/** The first issue date the widget lists. */
export const UNPAID_BILLS_FROM = "2026-11-01";

export interface UnpaidBillInput {
  id: string;
  vendor: string;
  cost: number;
  issueDate: string;
  createdAt: string;
  status: string;
  amountPaid: number;
  balance: number;
  isExpense: boolean;
  jobName: string;
  customerName: string;
}

export interface UnpaidBill extends UnpaidBillInput {
  paid: Exclude<PaidState, "paid">;
  owed: number;
}

export interface UnpaidBills {
  from: string;
  bills: UnpaidBill[];
  owed: number;
}

export function buildUnpaidBills(rows: UnpaidBillInput[], from = UNPAID_BILLS_FROM): UnpaidBills {
  const bills: UnpaidBill[] = [];
  for (const r of rows) {
    if (!r.issueDate || r.issueDate.slice(0, 10) < from) continue;
    if (r.status === "denied") continue;
    if (isSunsetName(r.vendor)) continue;
    if (r.isExpense) continue;
    const paid = billPaidState(r);
    if (paid === "paid") continue;
    const owed = Math.round((r.cost - r.amountPaid) * 100) / 100;
    bills.push({ ...r, paid, owed });
  }
  // Newest issue date first; the newest added first inside one day.
  bills.sort(
    (a, b) =>
      b.issueDate.slice(0, 10).localeCompare(a.issueDate.slice(0, 10)) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const owed = Math.round(bills.reduce((s, b) => s + b.owed, 0) * 100) / 100;
  return { from, bills, owed };
}
