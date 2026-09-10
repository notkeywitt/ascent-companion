/**
 * THE STRAY `isTaxable: false` WORKLIST — every bill line in a month that will
 * cost the client's invoice its sales tax, grouped so the office can fix them
 * by hand.
 *
 * ## Why this exists next to the invoice-review check
 *
 * `checks/taxableFlag.ts` answers "is this month's billing sound" and reports
 * MIXED bills only, because a wholly exempt bill is a decision it must not
 * argue with every month. This is the other job: a one-time cleanup of a defect
 * the Assistant itself created (`createLine` wrote `isTaxable: false` on every
 * line added to an existing bill until 2026-09-10), where a bill that happens
 * to be wholly untaxed is exactly as suspect as a mixed one.
 *
 * ## READ ONLY, on purpose
 *
 * Nothing here writes. Whether a cost is taxable is a tax decision, and a bulk
 * `UPDATE` across a month of live bills is the wrong shape for one — the same
 * data that motivated this has lines in it that are correctly non-taxable. So
 * this lists, links and totals, and a person clicks through.
 *
 * ## Two exclusions, and the reason each one is here
 *
 * OVERHEAD JOBS. Office, Shop and Electrical are Ascent's own. Their cost never
 * reaches a client invoice, so the flag on their lines moves no money and
 * listing them would bury the seventeen lines that matter under sixty that
 * don't. (August 2026: 75 lines, 58 of them Office and Shop.)
 *
 * SALES-TAX LINES, matched more strictly here than `isSalesTaxLine` matches
 * them. That helper checks the CODE FIRST and only falls back to the name, so a
 * line literally named "Sales Tax" but coded `01 00 00` reads as an ordinary
 * line — and two of those turned up in August, on Isabells Coffee bills.
 * Flipping one to taxable taxes the tax. On a worklist an over-cautious
 * exclusion costs nothing; a wrong inclusion costs a client's trust.
 */
import { isSalesTaxLine, SALES_TAX_LEGACY_LINE_NAME, SALES_TAX_LINE_NAME } from "@/lib/salesTax";
import { isNeverInvoiced } from "@/lib/invoiceReview/types";

/** One `isTaxable: false` cost item on a vendor bill, as JobTread hands it over. */
export interface UntaxedLine {
  id: string;
  name: string;
  cost: number;
  costCode: string;
  billId: string;
  billIssueDate: string;
  billStatus: string;
  /** How many cost items the bill carries in total — mixed vs wholly untaxed. */
  billLineCount: number;
  vendor: string;
  jobId: string;
  jobName: string;
  customerName: string;
}

/** One bill with lines to fix, and everything needed to go and fix them. */
export interface UntaxedBill {
  billId: string;
  issueDate: string;
  status: string;
  vendor: string;
  jobId: string;
  jobName: string;
  customerName: string;
  /** Every cost item on the bill, and how many of them are flagged. */
  lineCount: number;
  untaxedCount: number;
  /** True when some lines are taxable and some are not — the likelier slip. */
  mixed: boolean;
  cost: number;
  /** What the client is not being taxed, at the month's markup and rate. */
  taxAtStake: number;
  lines: { id: string; name: string; cost: number; costCode: string }[];
  jtUrl: string;
}

export interface TaxableLinesReport {
  ym: string;
  /** The assumptions behind `taxAtStake`, echoed so the page can state them. */
  markup: number;
  taxRate: number;
  bills: UntaxedBill[];
  totals: { bills: number; lines: number; cost: number; taxAtStake: number };
  /** Left out, and why — so the page can say what it is not showing. */
  skipped: { overheadLines: number; salesTaxLines: number };
}

/**
 * Ascent's own P&O, and the local rate. Both only ever SIZE the finding — no
 * money is computed from them and nothing is written. A caller with the month's
 * real invoice rate should pass it.
 */
export const DEFAULT_MARKUP = 1.18;
export const DEFAULT_TAX_RATE = 0.0835;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Is this line the bill's sales tax, however it was coded?
 *
 * Stricter than `isSalesTaxLine` on purpose — see the note at the top of the
 * file. The name check runs even when the line carries a different code.
 */
export function looksLikeSalesTax(line: {
  name: string;
  costCode: string;
}): boolean {
  if (isSalesTaxLine({ name: line.name, costCode: { number: line.costCode } })) return true;
  const name = line.name.trim();
  return name === SALES_TAX_LINE_NAME || name === SALES_TAX_LEGACY_LINE_NAME;
}

/**
 * Group the month's flagged lines into a worklist.
 *
 * Bills are ordered by what they cost the invoice, biggest first: this is a
 * list somebody works down, and the $5,000 excavation matters more than a
 * $8.95 shipping line.
 */
export function buildTaxableLinesReport(
  ym: string,
  lines: UntaxedLine[],
  opts: { markup?: number; taxRate?: number } = {},
): TaxableLinesReport {
  const markup = opts.markup ?? DEFAULT_MARKUP;
  const taxRate = opts.taxRate ?? DEFAULT_TAX_RATE;

  let overheadLines = 0;
  let salesTaxLines = 0;
  const byBill = new Map<string, UntaxedBill>();

  for (const l of lines) {
    if (isNeverInvoiced(l.jobId, l.jobName)) {
      overheadLines++;
      continue;
    }
    if (looksLikeSalesTax({ name: l.name, costCode: l.costCode })) {
      salesTaxLines++;
      continue;
    }

    let bill = byBill.get(l.billId);
    if (!bill) {
      bill = {
        billId: l.billId,
        issueDate: l.billIssueDate,
        status: l.billStatus,
        vendor: l.vendor,
        jobId: l.jobId,
        jobName: l.jobName,
        customerName: l.customerName,
        lineCount: l.billLineCount,
        untaxedCount: 0,
        mixed: false,
        cost: 0,
        taxAtStake: 0,
        lines: [],
        jtUrl: `https://app.jobtread.com/jobs/${encodeURIComponent(l.jobId)}/documents/${encodeURIComponent(l.billId)}`,
      };
      byBill.set(l.billId, bill);
    }
    bill.untaxedCount++;
    bill.cost = round(bill.cost + l.cost);
    bill.lines.push({ id: l.id, name: l.name, cost: l.cost, costCode: l.costCode });
  }

  const bills = [...byBill.values()];
  for (const b of bills) {
    // Counted AFTER grouping: `mixed` is about the whole bill, and a bill's
    // lines arrive one at a time. A bill whose line count could not be read
    // (0) is reported as mixed — the safer error, since it keeps it on the
    // list rather than quietly deciding it was a deliberate exemption.
    b.mixed = b.lineCount === 0 || b.untaxedCount < b.lineCount;
    b.taxAtStake = round(b.cost * markup * taxRate);
    b.lines.sort((a, c) => c.cost - a.cost);
  }
  bills.sort((a, b) => b.taxAtStake - a.taxAtStake || a.vendor.localeCompare(b.vendor));

  return {
    ym,
    markup,
    taxRate,
    bills,
    totals: {
      bills: bills.length,
      lines: bills.reduce((n, b) => n + b.untaxedCount, 0),
      cost: round(bills.reduce((n, b) => n + b.cost, 0)),
      taxAtStake: round(bills.reduce((n, b) => n + b.taxAtStake, 0)),
    },
    skipped: { overheadLines, salesTaxLines },
  };
}
