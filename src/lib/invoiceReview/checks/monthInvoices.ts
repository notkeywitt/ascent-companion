/**
 * DO THE MONTH'S INVOICES, TOGETHER, ADD UP TO THE MONTH?
 *
 * A job can be billed on more than one invoice in a month. Berger Bunkhouse,
 * October 2026: #473 bills the month with P&O, and #416 passes the Preferred
 * Plumbing fixtures through at cost. The month's cost is spread across both,
 * and a bill's lines may even be split between them. So the per-invoice checks
 * cannot say whether the month as a whole was billed. This one can.
 *
 * It compares cost against cost, so the markup and the tax never show up as a
 * difference:
 *
 *   the cost on every live invoice of the job (deposit lines left out)
 *   against
 *   the month's finalized bills and time entries that sit on those invoices.
 *
 * Bills and time on NO invoice are `uninvoiced`'s finding. They are printed
 * here only so the breakdown adds up to the month's whole cost.
 *
 * Two figures each have a legitimate range, so the expected cost is a range:
 *   - a bill's sales tax (its 88 80 00 line) stays off the client invoice, so
 *     a bill counts between its cost less tax and its full cost;
 *   - JobTread prices time at the rate in force when the invoice is BUILT, not
 *     the rate stored on the entry (costBasis.ts), so time counts between the
 *     stored cost and hours × today's rate.
 * Only a gap outside that range, and wider than `minGap`, is reported.
 */
import { defineJobCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";
import { depositPart, isAtCostInvoice } from "./shared";
import { hubHref } from "@/lib/hubUrl";

export interface MonthInvoicesConfig {
  /** Dollars of gap below which the month is taken to add up: rounding across
   *  a month of lines on several invoices. */
  minGap: number;
}

export const monthInvoicesCheck = defineJobCheck<MonthInvoicesConfig>({
  id: "month-invoices",
  title: "Month adds up across invoices",
  description:
    "The month's bills and labor add up to the cost on all of the job's invoices, however many there are.",
  kinds: ["month-invoices-gap"],
  scope: "job",
  run({ config, job, month }) {
    const out: Finding[] = [];
    if (job.neverInvoiced) return out;
    const live = job.invoices.filter((i) => i.status !== "denied");
    if (!live.length) return out;
    const liveIds = new Set(live.map((i) => i.id));
    const onLive = (ids: string[]) => ids.some((id) => liveIds.has(id));

    const invoiceCost = cents(live.reduce((s, i) => s + i.cost - depositPart(i).cost, 0));

    const billsOn = job.bills.filter((b) => onLive(b.invoiceIds));
    const billsOff = job.bills.filter((b) => !onLive(b.invoiceIds));
    const billsLow = billsOn.reduce((s, b) => s + b.cost - (b.taxAmount || 0), 0);
    const billsHigh = billsOn.reduce((s, b) => s + b.cost, 0);

    const timeOn = job.labor.filter((t) => onLive(t.invoiceIds));
    const timeOff = job.labor.filter((t) => !onLive(t.invoiceIds));
    let timeLow = 0;
    let timeHigh = 0;
    for (const t of timeOn) {
      const rate = month.laborRates?.get(t.employee)?.get(t.payType);
      const now = typeof rate === "number" && t.hours > 0 ? rate * t.hours : t.cost;
      timeLow += Math.min(t.cost, now);
      timeHigh += Math.max(t.cost, now);
    }

    const low = cents(billsLow + timeLow);
    const high = cents(billsHigh + timeHigh);
    const over = cents(invoiceCost - high);
    const under = cents(low - invoiceCost);
    const gap = over > config.minGap ? over : under > config.minGap ? -under : 0;
    if (!gap) return out;

    const offCost = cents(
      billsOff.reduce((s, b) => s + b.cost - (b.taxAmount || 0), 0) +
        timeOff.reduce((s, t) => s + t.cost, 0),
    );
    const monthCost = cents(
      job.bills.reduce((s, b) => s + b.cost - (b.taxAmount || 0), 0) +
        job.labor.reduce((s, t) => s + t.cost, 0),
    );
    const each = live
      .map((i) => {
        const tag = isAtCostInvoice(i) ? " at cost" : i.status === "draft" ? " draft" : "";
        return `#${i.number || i.id}${tag} ${money(i.cost - depositPart(i).cost)}`;
      })
      .join(", ");
    const expected = low === high ? money(low) : `${money(low)} to ${money(high)}`;
    const n = live.length;

    out.push({
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: "",
      invoiceNumber: "",
      key: findingKey("month-invoices-gap", job.jobId, month.ym),
      kind: "month-invoices-gap",
      severity: "warning",
      title:
        `${job.jobName || job.customerName} — ${n} invoice${n === 1 ? "" : "s"} carry ` +
        `${money(Math.abs(gap))} ${gap > 0 ? "more" : "less"} cost than ${month.monthLabel}'s bills and labor on them`,
      detail:
        `${month.monthLabel}: bills and labor cost ${money(monthCost)} before sales tax ` +
        `(${job.bills.length} bill${job.bills.length === 1 ? "" : "s"}, ` +
        `${job.labor.length} time entr${job.labor.length === 1 ? "y" : "ies"}). ` +
        `The job's ${n} invoice${n === 1 ? "" : "s"} carry ${money(invoiceCost)} of cost: ${each}. ` +
        `The bills and time on them should come to ${expected}` +
        (offCost > 0 ? `, and ${money(offCost)} is on no invoice yet. ` : `. `) +
        (gap > 0
          ? `The invoices hold ${money(gap)} more: a bill or time from another month, a line typed ` +
            `by hand, or one bill pulled onto two invoices.`
          : `The invoices hold ${money(-gap)} less: a line removed from an invoice after it ` +
            `pulled the bill, or part of a bill left off.`),
      amount: Math.abs(gap),
      sourceLink: hubHref(job.jobId, month.ym),
      sourceLabel: "Open the job",
    });
    return out;
  },
});
