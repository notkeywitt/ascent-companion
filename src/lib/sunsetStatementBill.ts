import type { NewBillLine } from "@/lib/jobtread";

/**
 * The shape of one Sunset statement's bill on the Office job. PURE: the route
 * and the test import it.
 *
 * A statement bill carries two lines, both coded 88 70 00: the statement total,
 * and the printed prompt discount as a negative line. The bill therefore equals
 * the net that is paid (owner, 2026-11-02).
 */

export interface StatementForBill {
  expId: string;
  project: string;
  statementDate: string; // YYYY-MM-DD, or YYYY-MM when the sheet held only the month
  statementNumber: string;
  total: string;
  discount: string;
}

const cents = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/**
 * The bill's issue date: the statement date, or the last day of the month when
 * the statement row holds only a month. "" when there is no usable date.
 */
export function statementIssueDate(statementDate: string): string {
  const s = String(statementDate ?? "").trim();
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (day) return `${day[1]}-${day[2]}-${day[3]}`;
  const month = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!month) return "";
  const y = Number(month[1]);
  const m = Number(month[2]);
  if (m < 1 || m > 12) return "";
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/**
 * The bill lines, or the reason there can be none. A statement whose total is
 * missing or not above zero, or whose discount is not a number, is refused
 * rather than billed wrong.
 */
export function statementBillLines(
  s: StatementForBill,
  leafId: string,
  csi: string,
): { lines: NewBillLine[]; net: number } | { error: string } {
  const total = cents(s.total);
  if (!(total > 0)) return { error: "the statement total is missing" };
  const discount = s.discount.trim() === "" ? 0 : cents(s.discount);
  if (!Number.isFinite(discount) || discount < 0) return { error: "the prompt discount did not read" };
  if (discount >= total) return { error: "the discount is not below the total" };

  const label = `Sunset statement ${s.statementNumber || s.expId}${s.project ? ` — ${s.project}` : ""}`;
  const line = (name: string, amount: number): NewBillLine => ({
    name,
    description: csi,
    unitCost: amount,
    quantity: 1,
    isTaxable: false,
    jobCostItemId: leafId,
    costCode: csi,
  });
  const lines = [line(label, total)];
  if (discount > 0) lines.push(line("Prompt payment discount", -discount));
  return { lines, net: Math.round((total - discount) * 100) / 100 };
}
