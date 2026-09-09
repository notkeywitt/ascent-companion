/**
 * IS THE CLIENT BEING BILLED THE SALES TAX ASCENT PAID?
 *
 * Sales tax on a vendor bill is its own cost item coded 88 80 00
 * (src/lib/salesTax.ts). It exists for ONE reason: QuickBooks needs a sales-tax
 * figure of its own, for the WA excise return. It is not client-billable work,
 * and it must never reach a customer invoice.
 *
 * WHY A CHECK AND NOT A GUARD. Nothing in JobTread can stop it. A cost code
 * carries no "not billable" flag (schema checked live 2026-09-09), and "Create
 * invoice" prices whatever cost items it pulls at cost × the job's markup — so a
 * tax line selected by mistake bills the client the tax AND a markup on it. The
 * only defence is that nobody selects it, and the only backstop is noticing.
 *
 * QUIET BY CONSTRUCTION. No threshold and no config: a tax line on a client
 * invoice is wrong at any amount. Confirmed live 2026-09-09 that no invoice in
 * the org carries one, so this check speaks the first time it happens and is
 * silent otherwise.
 */
import { isSalesTaxLine, SALES_TAX_CSI } from "@/lib/salesTax";
import { defineInvoiceCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";

export type SalesTaxLineConfig = Record<string, never>;

export const salesTaxLineCheck = defineInvoiceCheck<SalesTaxLineConfig>({
  id: "sales-tax-line",
  title: "Sales tax on a client invoice",
  description: `No ${SALES_TAX_CSI} sales-tax line reached a client invoice.`,
  kinds: ["invoice-sales-tax-line"],
  scope: "invoice",
  run({ job, invoice: inv }) {
    const out: Finding[] = [];
    const taxLines = inv.lines.filter((l) => isSalesTaxLine(l));
    if (!taxLines.length) return out;

    // What the client is charged for it — `price`, not `cost`. The two differ by
    // the job's markup, and the markup on tax is the part that is hardest to
    // explain to a client who asks.
    const billed = cents(taxLines.reduce((s, l) => s + (Number(l.price) || 0), 0));
    const paid = cents(taxLines.reduce((s, l) => s + (Number(l.cost) || 0), 0));

    out.push({
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      key: findingKey("invoice-sales-tax-line", job.jobId, inv.id),
      kind: "invoice-sales-tax-line",
      severity: "error",
      title: `Invoice #${inv.number || inv.id} — bills ${money(billed)} of sales tax`,
      detail:
        `${taxLines.length} line${taxLines.length === 1 ? "" : "s"} coded ${SALES_TAX_CSI} ` +
        `reached this invoice, charging the client ${money(billed)} against ${money(paid)} of ` +
        `tax Ascent paid its vendors. That tax is recorded on the bill only so QuickBooks gets ` +
        `a sales-tax figure for the excise return — it is not client-billable, and JobTread has ` +
        `marked it up like any other cost. Remove the line${taxLines.length === 1 ? "" : "s"} ` +
        `from the invoice, and leave ${SALES_TAX_CSI} unselected when pulling costs onto the ` +
        `next one.`,
      amount: billed,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
    return out;
  },
});
