/**
 * THE STRAY `isTaxable: false` WORKLIST — every line in a month that costs the
 * client's invoice its sales tax, split by WHICH DOCUMENT carries it.
 *
 * ## Two documents, two different fixes
 *
 * The flag lives on a cost item, and Create Invoice COPIES it from the bill's
 * line onto the invoice's own. They are separate records from that moment on,
 * so clearing one never moves the other:
 *
 *   ON THE CLIENT INVOICE — this is the line that actually bills the client.
 *                           Fixing it is what makes the month come out right.
 *   ON THE VENDOR BILL    — the source. Fixing it is what stops the next
 *                           invoice pulled from that bill inheriting it again.
 *
 * AND A PUSHED OR PAID BILL CANNOT BE EDITED, which is the reason this split
 * exists at all: for those, the invoice is the only side the office can reach.
 * So the two lists are kept apart, the invoice list leads, and a bill that is
 * paid says so rather than sending someone at a document that will not take
 * the change.
 *
 * ## Why the two sides size the money differently
 *
 * An invoice line HAS a price, so its unbilled tax is exact: `price × rate`.
 * A bill line has only a cost, and what the client would have been taxed on is
 * that cost plus the job's markup — so a bill's figure is an estimate and the
 * page says so.
 *
 * ## READ ONLY, on purpose
 *
 * Nothing here writes. Whether a cost is taxable is a tax decision, and a bulk
 * `UPDATE` across a month of live documents is the wrong shape for one — the
 * same data that motivated this has lines in it that are correctly non-taxable.
 * So this lists, links and totals, and a person clicks through.
 *
 * ## Two exclusions, and the reason each one is here
 *
 * OVERHEAD JOBS. Office, Shop and Electrical are Ascent's own. Their cost never
 * reaches a client invoice, so the flag on their lines moves no money and
 * listing them would bury the seventeen lines that matter under sixty that
 * don't. (August 2026: 75 bill lines, 58 of them Office and Shop.)
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

/** Which document carries the flag — and therefore where the fix is made. */
export type DocKind = "bill" | "invoice";

/** One `isTaxable: false` cost item, as JobTread hands it over. */
export interface UntaxedLine {
  id: string;
  name: string;
  /** What Ascent paid. The only figure a BILL line has. */
  cost: number;
  /** What the client is charged. 0 on a bill line, which carries no price. */
  price: number;
  costCode: string;
  docKind: DocKind;
  docId: string;
  /** The invoice's number, or the bill's. "" when it has none. */
  docNumber: string;
  docIssueDate: string;
  docStatus: string;
  /** How many cost items the document carries — mixed vs wholly untaxed. */
  docLineCount: number;
  /** Payments applied. A paid bill cannot be edited; the invoice is the fix. */
  docAmountPaid: number;
  /** The vendor, on a bill. "" on an invoice. */
  vendor: string;
  jobId: string;
  jobName: string;
  customerName: string;
}

/** One document with lines to fix, and everything needed to go and fix them. */
export interface UntaxedDoc {
  kind: DocKind;
  docId: string;
  docNumber: string;
  issueDate: string;
  status: string;
  amountPaid: number;
  /** True when payments are applied — a bill in that state cannot be edited. */
  locked: boolean;
  vendor: string;
  jobId: string;
  jobName: string;
  customerName: string;
  lineCount: number;
  untaxedCount: number;
  /** True when some lines are taxable and some are not — the likelier slip. */
  mixed: boolean;
  cost: number;
  price: number;
  /** Sales tax the client is not being charged. EXACT on an invoice (price ×
   *  rate); an estimate on a bill, which has no price of its own. */
  taxAtStake: number;
  estimated: boolean;
  lines: { id: string; name: string; cost: number; price: number; costCode: string }[];
  jtUrl: string;
}

export interface TaxableLinesReport {
  ym: string;
  /** The assumptions behind an ESTIMATED figure, echoed so the page can say so. */
  markup: number;
  taxRate: number;
  /** The client-facing side: fixing these is what makes the month come out
   *  right. Listed first for that reason. */
  invoices: UntaxedDoc[];
  /** The source side: fixing these stops it coming back. */
  bills: UntaxedDoc[];
  totals: {
    invoiceTax: number;
    billTax: number;
    lines: number;
  };
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
 * Is this line the document's sales tax, however it was coded?
 *
 * Stricter than `isSalesTaxLine` on purpose — see the note at the top of the
 * file. The name check runs even when the line carries a different code.
 */
export function looksLikeSalesTax(line: { name: string; costCode: string }): boolean {
  if (isSalesTaxLine({ name: line.name, costCode: { number: line.costCode } })) return true;
  const name = line.name.trim();
  return name === SALES_TAX_LINE_NAME || name === SALES_TAX_LEGACY_LINE_NAME;
}

/**
 * Group the month's flagged lines into two worklists, one per document kind.
 *
 * Within each, documents are ordered by what they cost the client, biggest
 * first: this is a list somebody works down, and a $5,000 excavation matters
 * more than an $8.95 shipping line.
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
  const byDoc = new Map<string, UntaxedDoc>();

  for (const l of lines) {
    if (isNeverInvoiced(l.jobId, l.jobName)) {
      overheadLines++;
      continue;
    }
    if (looksLikeSalesTax({ name: l.name, costCode: l.costCode })) {
      salesTaxLines++;
      continue;
    }

    let doc = byDoc.get(l.docId);
    if (!doc) {
      doc = {
        kind: l.docKind,
        docId: l.docId,
        docNumber: l.docNumber,
        issueDate: l.docIssueDate,
        status: l.docStatus,
        amountPaid: l.docAmountPaid,
        // A bill with money against it is the case that started this: it cannot
        // be edited, so the invoice is the only side the office can reach.
        locked: l.docKind === "bill" && l.docAmountPaid > 0,
        vendor: l.vendor,
        jobId: l.jobId,
        jobName: l.jobName,
        customerName: l.customerName,
        lineCount: l.docLineCount,
        untaxedCount: 0,
        mixed: false,
        cost: 0,
        price: 0,
        taxAtStake: 0,
        // A bill line has no price, so its figure is cost plus the job's markup.
        estimated: l.docKind === "bill",
        lines: [],
        jtUrl: `https://app.jobtread.com/jobs/${encodeURIComponent(l.jobId)}/documents/${encodeURIComponent(l.docId)}`,
      };
      byDoc.set(l.docId, doc);
    }
    doc.untaxedCount++;
    doc.cost = round(doc.cost + l.cost);
    doc.price = round(doc.price + l.price);
    doc.lines.push({ id: l.id, name: l.name, cost: l.cost, price: l.price, costCode: l.costCode });
  }

  const docs = [...byDoc.values()];
  for (const d of docs) {
    // Counted AFTER grouping: `mixed` is about the whole document, and its
    // lines arrive one at a time. A document whose line count could not be read
    // (0) is reported as mixed — the safer error, since it keeps it on the list
    // rather than quietly deciding it was a deliberate exemption.
    d.mixed = d.lineCount === 0 || d.untaxedCount < d.lineCount;
    // The invoice knows what the client is charged, so its figure is exact.
    d.taxAtStake = round((d.estimated ? d.cost * markup : d.price) * taxRate);
    d.lines.sort((a, c) => (c.price || c.cost) - (a.price || a.cost));
  }

  const rank = (a: UntaxedDoc, b: UntaxedDoc) =>
    b.taxAtStake - a.taxAtStake || a.jobName.localeCompare(b.jobName);
  const invoices = docs.filter((d) => d.kind === "invoice").sort(rank);
  const bills = docs.filter((d) => d.kind === "bill").sort(rank);

  return {
    ym,
    markup,
    taxRate,
    invoices,
    bills,
    totals: {
      invoiceTax: round(invoices.reduce((n, d) => n + d.taxAtStake, 0)),
      billTax: round(bills.reduce((n, d) => n + d.taxAtStake, 0)),
      lines: docs.reduce((n, d) => n + d.untaxedCount, 0),
    },
    skipped: { overheadLines, salesTaxLines },
  };
}
