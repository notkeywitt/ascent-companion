/**
 * Billing-period + bill-date standard, ported from the Apps Script engine
 * (Config.js deriveBillingPeriod + JobTread.js _jtComputeBillDates). These rules
 * have caused real production bugs when re-derived from scratch — keep this file
 * in lockstep with the Apps Script originals.
 *
 * THE rule: the billing period derives from the bill's ARRIVAL date (here, the
 * moment it's uploaded), NEVER from a date printed on the document. Gemini's
 * extracted dates are only ever used for the vendor's payment Due Date.
 */

/** Company timezone — matches appsscript.json. The server may run in UTC, so all
 *  "what day is it" decisions convert to this zone first (a bill uploaded at
 *  11 PM Pacific on the 10th must NOT count as the 11th). */
const COMPANY_TZ = "America/Los_Angeles";

/** Calendar parts of a Date in the company timezone. */
export function companyDateParts(d: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: COMPANY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD
  const [y, m, day] = fmt.format(d).split("-").map((s) => parseInt(s, 10));
  return { year: y, month: m, day };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Last day of a 1-based month. */
const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

export interface BillingPeriod {
  billingMonthNum: number; // 1..12
  billingYear: number;
}

/**
 * Billing period from the bill's arrival date (port of deriveBillingPeriod):
 *   - Non-Sunset bills arriving ON OR BEFORE the 10th bill to the PREVIOUS month
 *     (arrives Jul 10 → June billing). The 10th is INCLUSIVE, matching the
 *     10th-to-10th window the Invoicing tab (/stage) already uses.
 *   - After the 10th → arrival month.
 *   - Sunset bills ALWAYS bill in their arrival month.
 */
export function deriveBillingPeriod(received: Date, isSunset: boolean): BillingPeriod {
  const p = companyDateParts(received);
  let month = p.month;
  let year = p.year;
  if (!isSunset && p.day <= 10) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return { billingMonthNum: month, billingYear: year };
}

export interface BillDates {
  issueDate: string; // yyyy-MM-dd
  dueDate: string | null; // yyyy-MM-dd, or null when dueDays applies
  dueDays: number | null; // net terms fallback (30) when no usable due date
  billing: BillingPeriod;
  warnings: string[];
}

/**
 * JT issue/due dates for a newly ingested bill (port of _jtComputeBillDates,
 * simplified to the create-from-upload case where arrival = now and the row is
 * always a billable "Bill"):
 *   - Sunset: issueDate = the arrival date itself; due the 10th of the month
 *     AFTER the billing month.
 *   - Everyone else: issueDate = last day of the billing month; due date from
 *     the document if usable, else net-30. JT rejects due < issue, so a stale
 *     extracted due date falls back to net-30 (same guard as production).
 */
export function computeBillDates(
  received: Date,
  isSunset: boolean,
  extractedDueDate?: string,
): BillDates {
  const warnings: string[] = [];
  const billing = deriveBillingPeriod(received, isSunset);
  const p = companyDateParts(received);

  let issueDate: string;
  let dueDate: string | null = null;
  let dueDays: number | null = null;

  if (isSunset) {
    issueDate = iso(p.year, p.month, p.day); // Sunset retains its arrival date
    // 10th of the month AFTER the billing month (new Date(y, m, 10) with 1-based
    // m already lands in the following month).
    const dd = new Date(billing.billingYear, billing.billingMonthNum, 10);
    dueDate = iso(dd.getFullYear(), dd.getMonth() + 1, dd.getDate());
  } else {
    issueDate = iso(
      billing.billingYear,
      billing.billingMonthNum,
      lastDayOfMonth(billing.billingYear, billing.billingMonthNum),
    );
    const raw = String(extractedDueDate ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      dueDate = raw;
    } else {
      dueDays = 30;
    }
    // Guard: JT rejects a bill whose due date precedes its issue date. ISO
    // strings compare chronologically.
    if (dueDate && dueDate < issueDate) {
      warnings.push(`Due date ${dueDate} precedes issue date ${issueDate}; using net-30 instead.`);
      dueDate = null;
      dueDays = 30;
    }
  }

  return { issueDate, dueDate, dueDays, billing, warnings };
}

/**
 * A vendor bill's sales tax, from whatever the extractor read off the invoice.
 * Blank, negative and unparseable all read 0.
 *
 * There is no per-line taxability decision any more: the tax is its own cost
 * item coded 88 80 00 (src/lib/salesTax.ts), the document's tax field is pinned
 * to 0, and a vendor bill carries no tax rate — so `isTaxable` on a bill line
 * moves no money and stays at JobTread's own default.
 */
export function salesTaxAmount(taxAmountRaw: unknown): number {
  const n = Number(taxAmountRaw);
  return !Number.isFinite(n) || n <= 0 ? 0 : Math.round(n * 100) / 100;
}

/**
 * Guardrail (port of _taxReconcileWarn): line items + Tax should equal Amount.
 * Returns a human-readable warning when they don't (±$0.05), else null.
 */
export function taxReconcileWarning(extracted: {
  Amount?: number;
  Tax?: number;
  items?: { price?: number; quantity?: number; line_total?: number }[];
}): string | null {
  const amount = Number(extracted.Amount) || 0;
  const tax = Number(extracted.Tax) || 0;
  const items = extracted.items ?? [];
  if (amount <= 0 || items.length === 0) return null; // nothing to check against

  let itemsSum = 0;
  for (const it of items) {
    const lt =
      it.line_total !== undefined && it.line_total !== null
        ? Number(it.line_total)
        : (Number(it.price) || 0) * (Number(it.quantity) || 1);
    itemsSum += Number(lt) || 0;
  }

  const delta = amount - (itemsSum + tax);
  if (Math.abs(delta) <= 0.05) return null;
  return (
    `Amount ${amount.toFixed(2)} != line items ${itemsSum.toFixed(2)} + tax ${tax.toFixed(2)} ` +
    `(off by ${delta.toFixed(2)}). Possible missed or mis-scoped sales tax — verify before approving.`
  );
}
