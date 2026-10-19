/**
 * A BILL WHOSE LINES ALREADY INCLUDE THE TAX ITS 88 80 00 LINE ADDS AGAIN.
 *
 * Built from Kevin Berger / Bunkhouse, July 2026 (invoice #002-221). Home Depot
 * printed $50.98 + $4.26 tax = $55.24 and Fasteners Plus $414.99 + $34.65 =
 * $449.64. Both were captured with the receipt TOTAL as the lines, and the tax
 * was added on top afterwards, so JobTread held $59.50 and $484.29. The client
 * paid the vendor's tax as cost, marked up, and then the invoice's WSST on top.
 * The client found it; nothing in the review could have.
 *
 * WHY NOTHING ELSE SEES IT. The backup check accepts `cost − tax` against the
 * filename, and that is exactly the tax-inclusive receipt total — it passes.
 * The invoice foots. The bill is coded and pushed. Only the tax's own SHAPE
 * gives it away: see `taxLooksDoubled` in src/lib/salesTax.ts.
 *
 * Drafts are read too. A doubled draft is caught before it is approved, which
 * is the cheap time to catch it.
 */
import { taxLooksDoubled } from "@/lib/salesTax";
import { defineJobCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";
import { billLink } from "./shared";

export interface TaxDoubledConfig {
  /**
   * The sales-tax rates the office pays. A rate missing here makes the check
   * silent on that vendor, never wrong — add a vendor's counter rate when it
   * differs from the county's.
   */
  rates: number[];
  /** Below this the rounding covers both readings and the shape proves nothing. */
  minTax: number;
}

export const taxDoubledCheck = defineJobCheck<TaxDoubledConfig>({
  id: "tax-doubled",
  title: "Tax counted twice on a bill",
  description: "No bill's lines already include the sales tax its 88 80 00 line adds.",
  kinds: ["bill-tax-doubled"],
  scope: "job",
  run({ job, config }) {
    const out: Finding[] = [];
    for (const bill of [...job.bills, ...job.draftBills]) {
      if (!(bill.taxAmount > 0)) continue;
      const lines = cents(bill.cost - bill.taxAmount);
      const shape = taxLooksDoubled(lines, bill.taxAmount, config.rates, config.minTax);
      if (!shape.doubled || shape.rate === null) continue;

      const pct = `${(shape.rate * 100).toFixed(2).replace(/0$/, "")}%`;
      const billed = bill.sentInvoiceIds.length > 0;
      out.push({
        jobId: job.jobId,
        jobName: job.jobName,
        customerName: job.customerName,
        invoiceId: "",
        invoiceNumber: "",
        key: findingKey("bill-tax-doubled", job.jobId, bill.id),
        kind: "bill-tax-doubled",
        severity: "error",
        title: `${bill.vendor || bill.label} ${money(bill.cost)} — the lines already include the ${money(bill.taxAmount)} tax`,
        detail:
          `The lines come to ${money(lines)}, which is ${money(shape.pretax)} plus ${pct} tax ` +
          `(${money(bill.taxAmount)}). The sales-tax line adds that same ${money(bill.taxAmount)} ` +
          `again, so the bill costs ${money(bill.cost)} against a receipt of ${money(lines)}. ` +
          `Check the receipt: if it reads ${money(shape.pretax)} + ${money(bill.taxAmount)} tax, ` +
          `set the lines to the pre-tax ${money(shape.pretax)}. ` +
          (billed
            ? `This bill is already on a sent client invoice — credit the client the ` +
              `${money(bill.taxAmount)} plus its markup and tax on the next one.`
            : `It is on no sent invoice yet, so fixing the bill is enough.`),
        amount: bill.taxAmount,
        sourceLink: billLink(job.jobId, bill.id),
        target: { kind: "bill", billId: bill.id },
        sourceLabel: "Open the bill",
      });
    }
    return out;
  },
});
