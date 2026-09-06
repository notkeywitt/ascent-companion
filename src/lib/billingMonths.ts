/**
 * Billing months — the ONE list, the ONE label and the ONE issueDate rule.
 *
 * A bill is filed in a month by its `issueDate`, and the convention every write
 * path here follows is the LAST DAY of that month — what `/api/bill-issuedate`
 * expects. `ym` ("2026-07") is the key everything else matches on.
 *
 * This existed four times before 2026-09-06: Board, DraftWorkbench, the bill
 * page and Roster each built their own list, and they disagreed on all three
 * things that could differ —
 *
 *   - how many months (15 or 18),
 *   - what the option's `value` was (the ym, or the last day),
 *   - how the label was spelled (a hand-rolled MONTHS array, or toLocaleString).
 *
 * The value difference is the one that bit: a picker whose options carried a
 * full date could not match a `bill.issueDate.slice(0, 7)`, so the same Select
 * showed the month on one surface and blank on another. The option `value` is
 * the ym here, and `issueDateFor` is the only place the last day is worked out.
 */

/** The months a bill can be filed in: this month, then back `count - 1` more. */
export function billingMonths(count = 18): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: monthLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-07" → "July 2026". Returns the input unchanged if it isn't a ym. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${y}` : ym;
}

/**
 * The issueDate that files a bill in `ym` — the last day of that month.
 * `new Date(y, m, 0)` is the last day of month `m` (months are 0-based, so `m`
 * is already the NEXT month and day 0 steps back one).
 */
export function issueDateFor(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
