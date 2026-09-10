/**
 * ONE LINE ON A BILL IS MARKED NON-TAXABLE AND ITS SIBLINGS ARE NOT.
 *
 * A JobTread cost item carries an `isTaxable` flag, and a client invoice built
 * from those items taxes only the ones that carry it. So a single line cleared
 * by mistake quietly shrinks the tax base of every invoice it reaches, and the
 * client is under-billed the sales tax Ascent still owes the state on it.
 *
 * WHY NOTHING ELSE SEES IT. The invoice foots — `invoice-math` recomputes
 * `priceWithTax − price` against the tax JobTread STATES, and JobTread states
 * the reduced figure, so the arithmetic is internally perfect. The bill is
 * captured, coded, backed by its PDF and pushed to QuickBooks. The only thing
 * that disagrees is the tracking sheet, which has no per-line flag and taxes
 * the whole subtotal — and nobody reconciles the sheet's bottom line against
 * the invoice, because they are supposed to be the same number.
 *
 * Built from Ferron / Otis Perkins Addition, August 2026: Element Smart
 * Roofing's $25,083.75 bill, 13 lines, all coded 07 62 00, twelve taxable and
 * one — "Roof Work Scope … Progress Payment", $4,156.25 — not. Invoice #382
 * came to $169,120.20 where the sheet said $169,530.51, and the $410.31 gap
 * was that line's tax.
 *
 * THE RULE IS "MIXED", NOT "NON-TAXABLE". A bill whose lines are ALL exempt is
 * a decision — a resale certificate, an exempt customer, a non-taxable service
 * — and reporting it every month would train the office to skim past this. One
 * line out of step with its own siblings is not a decision, because nobody
 * makes a tax decision about a twelfth of a roof.
 */
import { defineJobCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";

export interface TaxableFlagConfig {
  /**
   * Ignore a mixed bill whose non-taxable lines cost less than this. The tax at
   * stake is a few percent of it, so a small line is pennies and the finding
   * would cost more attention than the money.
   */
  minCost: number;
  /**
   * The rate used to size what is not being billed, when no invoice on the job
   * states one of its own. Only ever used to put a number on the finding —
   * nothing here decides what tax is owed.
   */
  fallbackTaxRate: number;
}

export const taxableFlagCheck = defineJobCheck<TaxableFlagConfig>({
  id: "taxable-flag",
  title: "A line marked non-taxable among taxable ones",
  description:
    "No vendor bill has a stray non-taxable line — it shrinks the client invoice's tax base.",
  kinds: ["bill-line-not-taxable"],
  scope: "job",
  run({ job, config }) {
    const out: Finding[] = [];

    // The job's own rate where an invoice states one, so the estimate matches
    // the document the office is about to send.
    const stated = job.invoices.find((inv) => inv.taxRate > 0)?.taxRate;
    const rate = stated && stated > 0 ? stated : config.fallbackTaxRate;

    // The client is taxed on PRICE, not on cost, so the shortfall carries the
    // markup too. Derived from the job's own invoice rather than configured:
    // the markup is per job and JobTread already applied it. Ferron, August
    // 2026 — 156,464.90 / 132,597.87 = 1.18, and 4,156.25 x 1.18 x 0.0835 is
    // the $409.52 that separated the invoice from the tracking sheet.
    const priced = job.invoices.find((inv) => inv.cost > 0 && inv.price > 0);
    const markup = priced ? priced.price / priced.cost : 1;

    for (const bill of job.bills) {
      // lineCount is 0 when it could not be read; without it "mixed" is not a
      // question this can answer, and guessing would invent findings.
      if (!bill.untaxedLineCount || !bill.lineCount) continue;
      // Every line exempt is a decision. See the note at the top.
      if (bill.untaxedLineCount >= bill.lineCount) continue;
      if (bill.untaxedCost < config.minCost) continue;

      const taxable = bill.lineCount - bill.untaxedLineCount;
      const shortfall = cents(bill.untaxedCost * markup * rate);

      out.push({
        jobId: job.jobId,
        jobName: job.jobName,
        customerName: job.customerName,
        // The flag lives on the BILL, and the same bill can reach more than one
        // invoice. Blaming a document would put the finding in the wrong place.
        invoiceId: "",
        invoiceNumber: "",
        key: findingKey("bill-line-not-taxable", job.jobId, bill.id),
        kind: "bill-line-not-taxable",
        severity: "error",
        title: `${bill.vendor || bill.label} — ${bill.untaxedLineCount} of ${bill.lineCount} lines marked non-taxable`,
        detail:
          `${money(bill.untaxedCost)} of this bill sits on ${bill.untaxedLineCount} line` +
          `${bill.untaxedLineCount === 1 ? "" : "s"} flagged non-taxable, while the other ` +
          `${taxable} ${taxable === 1 ? "is" : "are"} taxable. A client invoice taxes only the ` +
          `taxable lines, so that flag takes those costs out of the tax base and bills the ` +
          `client roughly ${money(shortfall)} less sales tax than the tracking sheet does — ` +
          `the sheet has no per-line flag and taxes the whole subtotal. Nothing else notices: ` +
          `the invoice still foots, because JobTread states the reduced tax and the arithmetic ` +
          `checks out against it. Open the bill and confirm the flag is deliberate; if it is ` +
          `not, clear it and re-pull the invoice.`,
        amount: shortfall,
        sourceLink: `/bill/${encodeURIComponent(bill.id)}`,
        sourceLabel: "Open the bill",
      });
    }

    return out;
  },
});
