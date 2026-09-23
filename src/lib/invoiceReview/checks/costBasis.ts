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
 *
 * ## Time is priced at the CURRENT rate, not the entry's stored rate
 *
 * JobTread snapshots an hourly rate onto a time entry and never revisits it,
 * but it prices an invoice's labor lines at the rate the membership carries
 * WHEN THE INVOICE IS BUILT. Raise a rate, then raise the invoice, and the two
 * numbers disagree by the raise — the entry still says the old rate, the
 * invoice line says the new one.
 *
 * Probe-confirmed on Moon Spring / Pole Barn, August 2026: invoice #40's cost
 * was $11,973.41 against one $9,385.08 bill and 20 August time entries worth
 * $2,295.00 at their stored rates. Every entry was August's; nothing came from
 * another month. The $293.33 gap was three raises applied after the entries
 * were written — Ty O'Steen $75→$85 (15 h), Casey $95→$105 (11 h), Tommy
 * $75→$95 (1.67 h) — and the invoice had priced all 27.67 hours at the new
 * rates.
 *
 * So the seen time is valued at the rate card (`month.laborRates`, the same
 * reference `laborRateCheck` uses), falling back to the entry's own cost when
 * the grant could not read pay types. Reporting the raise is laborRateCheck's
 * job; this check's only job is to stop calling it "cost from another month".
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
    // The rate the INVOICE used — see the header. Null rate card ⇒ the entry's
    // own cost, which is the best number available.
    const timeCost = onThisInvoiceTime.reduce((s, t) => {
      const current = month.laborRates?.get(t.employee)?.get(t.payType);
      return s + (typeof current === "number" && t.hours > 0 ? current * t.hours : t.cost);
    }, 0);
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
