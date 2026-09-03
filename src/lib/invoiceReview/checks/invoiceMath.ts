/**
 * DOES THE INVOICE FOOT? — the arithmetic on one client invoice.
 *
 * Four sums, all of which JobTread also holds an answer to. THE HOUSE RULE
 * applies in full here: a figure is recomputed only in order to COMPARE it with
 * the one JobTread states, and the finding reports the disagreement. It never
 * decides which side is right and it never corrects anything.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";

export type InvoiceMathConfig = Record<string, never>;

export const invoiceMathCheck = defineInvoiceCheck<InvoiceMathConfig>({
  id: "invoice-math",
  title: "Invoice arithmetic",
  description: "Lines multiply out, lines sum to the total, and tax and balance reconcile.",
  kinds: ["math-line", "math-total", "math-tax", "math-balance"],
  scope: "invoice",
  run({ global, job, invoice: inv }) {
    const TOL = global.tolerance;
    const out: Finding[] = [];
    const base = {
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
    };
    const label = `Invoice #${inv.number || inv.id}`;

    // ── Per line: quantity × unit price vs. the extended price JobTread holds.
    // Skipped when either factor is zero: a flat-price line (qty 0, or a price
    // typed directly) is normal in JobTread and its "product" is meaningless.
    for (const line of inv.lines) {
      if (!line.quantity || !line.unitPrice) continue;
      const expect = cents(line.quantity * line.unitPrice);
      if (Math.abs(expect - cents(line.price)) <= TOL) continue;
      out.push({
        ...base,
        key: findingKey("math-line", job.jobId, `${inv.id}:${line.id}`),
        kind: "math-line",
        severity: "error",
        title: `${label} — line doesn't multiply out`,
        detail:
          `"${line.name}": ${line.quantity} × ${money(line.unitPrice)} = ${money(expect)}, ` +
          `but the line is billed at ${money(line.price)} — a difference of ` +
          `${money(cents(line.price) - expect)}.`,
        amount: cents(line.price) - expect,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }

    // ── Lines vs. the invoice's pre-tax price.
    if (inv.lines.length) {
      const sum = cents(inv.lines.reduce((s, l) => s + l.price, 0));
      if (Math.abs(sum - cents(inv.price)) > TOL) {
        out.push({
          ...base,
          key: findingKey("math-total", job.jobId, inv.id),
          kind: "math-total",
          severity: "error",
          title: `${label} — lines don't sum to the total`,
          detail:
            `The ${inv.lines.length} line items add to ${money(sum)}, but the invoice's ` +
            `pre-tax total is ${money(inv.price)} — off by ${money(cents(inv.price) - sum)}.`,
          amount: cents(inv.price) - sum,
          sourceLink: inv.jtUrl,
          sourceLabel: "Open in JobTread",
        });
      }
    }

    // ── Tax: the with-tax total minus the pre-tax total must be the stated tax.
    const taxGap = cents(cents(inv.priceWithTax) - cents(inv.price) - cents(inv.tax));
    if (Math.abs(taxGap) > TOL) {
      out.push({
        ...base,
        key: findingKey("math-tax", job.jobId, inv.id),
        kind: "math-tax",
        severity: "error",
        title: `${label} — tax doesn't reconcile`,
        detail:
          `${money(inv.priceWithTax)} with tax − ${money(inv.price)} pre-tax = ` +
          `${money(cents(inv.priceWithTax) - cents(inv.price))}, but the invoice states ` +
          `${money(inv.tax)} of tax — off by ${money(taxGap)}.`,
        amount: taxGap,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }

    // ── Balance: what's still owed must be the total less what's been paid.
    //
    // A DRAFT GETS A DIFFERENT ASSERTION, NOT AN EXEMPTION. Reviewing drafts is
    // the entire point: once an invoice is issued it can no longer be edited, so
    // a draft is the only window in which a finding can still be acted on. No
    // check here may quietly stop looking at one.
    //
    // But JobTread does not compute `balance` until a document is issued.
    // Probe-confirmed org-wide 2026-09-03: EVERY draft carries `balance: 0` AND
    // `amountPaid: 0`, whatever it totals — not one exception in the whole
    // organization, drafts with an issue date included. So on a draft the
    // identity below reduces to `priceWithTax - 0 - 0` and fires on every draft
    // that totals anything at all. That is a 100% false-positive rate, and it
    // reported the full invoice total as the size of the discrepancy.
    //
    // So a draft is checked against the state a draft is SUPPOSED to be in —
    // nothing paid, nothing owed — and reports when JobTread breaks it. That is
    // the one thing a draft's balance can actually be wrong about. It has never
    // yet been seen wrong, which is precisely what makes it worth hearing.
    const isDraft = inv.status === "draft";
    const balGap = isDraft
      ? cents(cents(inv.amountPaid) + cents(inv.balance))
      : cents(cents(inv.priceWithTax) - cents(inv.amountPaid) - cents(inv.balance));
    if (Math.abs(balGap) > TOL) {
      out.push({
        ...base,
        key: findingKey("math-balance", job.jobId, inv.id),
        kind: "math-balance",
        severity: "warning",
        title: isDraft
          ? `${label} — draft already carries a payment or a balance`
          : `${label} — balance doesn't reconcile`,
        detail: isDraft
          ? `This invoice is still a draft, so JobTread should hold nothing paid and ` +
            `nothing owed against it. It states ${money(inv.amountPaid)} paid and a ` +
            `balance of ${money(inv.balance)}. Every other draft in the organization ` +
            `holds zero for both, so this one is being treated differently and it is ` +
            `worth finding out why before the invoice is issued.`
          : `${money(inv.priceWithTax)} billed − ${money(inv.amountPaid)} paid = ` +
            `${money(cents(inv.priceWithTax) - cents(inv.amountPaid))}, but the invoice's ` +
            `balance reads ${money(inv.balance)} — off by ${money(balGap)}.`,
        amount: balGap,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }

    return out;
  },
});
