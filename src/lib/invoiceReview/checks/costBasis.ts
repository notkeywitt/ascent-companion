/**
 * DID THE INVOICE REACH OUTSIDE THE MONTH?
 *
 * JobTread sets an invoice's `cost` from the bills AND time entries it pulled,
 * so comparing that against what we can SEE for this month — both, not just
 * bills — says whether it also pulled in cost from another period.
 *
 * A bare "Create invoice" pulls uninvoiced TIME the same way it pulls bills
 * (see JobTread.js `getUninvoicedBills`), and an invoice can be time-heavy or
 * time-only — Berger Main House's August invoice was $6,735 total against a
 * single $4,163.75 bill, the rest being 20 time entries. Comparing bills alone
 * called that "$2,571.25 of cost from outside the month" and blamed "bills
 * issued in another month" when there were no other bills at all; it was
 * entirely labor, on this invoice, this month.
 *
 * Only flagged in ONE direction — when the invoice's cost EXCEEDS what we can
 * see. The other direction just means the invoice covers part of the month,
 * which is normal for a split invoice, and flagging it would fire on every
 * job that bills in stages.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";

export type CostBasisConfig = Record<string, never>;

export const costBasisCheck = defineInvoiceCheck<CostBasisConfig>({
  id: "cost-basis",
  title: "Cost basis",
  description: "The invoice's cost basis is accounted for by the month's bills and time on it.",
  kinds: ["math-cost-basis"],
  scope: "invoice",
  run({ global, job, month, invoice: inv }) {
    const out: Finding[] = [];
    const monthBillCost = new Map(job.bills.map((b) => [b.id, b.cost]));

    const onThisInvoice = job.bills.filter((b) => b.invoiceIds.includes(inv.id));
    const onThisInvoiceTime = job.labor.filter((t) => t.invoiceIds.includes(inv.id));
    const billCost = onThisInvoice.reduce((s, b) => s + (monthBillCost.get(b.id) ?? 0), 0);
    const timeCost = onThisInvoiceTime.reduce((s, t) => s + t.cost, 0);
    const seenCost = cents(billCost + timeCost);
    const outside = cents(cents(inv.cost) - seenCost);
    // Nothing to compare against means nothing to say — not "!onThisInvoice
    // .length" alone, or a time-only (or time-heavy) invoice would short-
    // circuit before its time entries even get a chance to explain the cost.
    if ((!onThisInvoice.length && !onThisInvoiceTime.length) || outside <= global.tolerance) {
      return out;
    }

    const seenParts: string[] = [];
    if (onThisInvoice.length) {
      seenParts.push(`${onThisInvoice.length} bill${onThisInvoice.length > 1 ? "s" : ""}`);
    }
    if (onThisInvoiceTime.length) {
      seenParts.push(`${onThisInvoiceTime.length} time entr${onThisInvoiceTime.length > 1 ? "ies" : "y"}`);
    }

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
        `The invoice's cost basis is ${money(inv.cost)}, but the ${seenParts.join(" and ")} we ` +
        `can see for ${month.monthLabel} total ${money(seenCost)}. The remaining ${money(outside)} ` +
        `came from a bill or time entry issued in another month — check that it was meant to be ` +
        `billed now.`,
      amount: outside,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
    return out;
  },
});
