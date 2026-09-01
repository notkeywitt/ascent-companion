/**
 * DID THE INVOICE REACH OUTSIDE THE MONTH?
 *
 * JobTread sets an invoice's `cost` from the bills it pulled, so comparing that
 * against the bills we can SEE for this month says whether it also pulled in
 * cost from another period.
 *
 * Only flagged in ONE direction — when the invoice's cost EXCEEDS the month's
 * bills on it. The other direction just means the invoice covers part of the
 * month, which is normal for a split invoice, and flagging it would fire on
 * every job that bills in stages.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";

export type CostBasisConfig = Record<string, never>;

export const costBasisCheck = defineInvoiceCheck<CostBasisConfig>({
  id: "cost-basis",
  title: "Cost basis",
  description: "The invoice's cost basis is accounted for by the month's bills on it.",
  kinds: ["math-cost-basis"],
  scope: "invoice",
  run({ global, job, month, invoice: inv }) {
    const out: Finding[] = [];
    const monthBillCost = new Map(job.bills.map((b) => [b.id, b.cost]));

    const onThisInvoice = job.bills.filter((b) => b.invoiceIds.includes(inv.id));
    const seenCost = cents(onThisInvoice.reduce((s, b) => s + (monthBillCost.get(b.id) ?? 0), 0));
    const outside = cents(cents(inv.cost) - seenCost);
    if (!onThisInvoice.length || outside <= global.tolerance) return out;

    out.push({
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      key: findingKey("math-cost-basis", job.jobId, inv.id),
      kind: "math-cost-basis",
      severity: "warning",
      title: `Invoice #${inv.number || inv.id} — ${money(outside)} of cost from outside ${month.monthLabel}`,
      detail:
        `The invoice's cost basis is ${money(inv.cost)}, but the ${onThisInvoice.length} ` +
        `${month.monthLabel} bill${onThisInvoice.length > 1 ? "s" : ""} on it total ` +
        `${money(seenCost)}. The remaining ${money(outside)} came from bills issued in ` +
        `another month — check that it was meant to be billed now.`,
      amount: outside,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
    return out;
  },
});
