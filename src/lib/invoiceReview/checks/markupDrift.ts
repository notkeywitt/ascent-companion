/**
 * IS THIS CUSTOMER BEING BILLED AT THE RATE WE BILL THEM?
 *
 * ## Why this has to be learned rather than configured
 *
 * Ascent charges DIFFERENT MARKUPS TO DIFFERENT CUSTOMERS. So there is no house
 * rate to check an invoice against, and there never will be — a check that
 * compared every invoice to one number would be wrong for nearly every client.
 * The only honest baseline is what this customer has actually been billed over
 * the last several months, which is a learned norm and nothing else.
 *
 * That makes this the second check in the review that could not have been
 * written before the run history existed (`vendorSilent` was the first), and
 * unlike that one it is not a convenience: there is no configured version of
 * this check that would have worked.
 *
 * ## What it compares
 *
 * The BLENDED rate for the customer this month — everything invoiced to them,
 * total price over total cost — against the median of their previous months.
 * Blended rather than per-invoice because "what do we charge them" is one
 * number, and a customer billed on three invoices in a month would otherwise
 * produce three noisy near-misses instead of one clear answer.
 *
 * ## What keeps it quiet
 *
 * A markup rate wanders for ordinary reasons: a month heavy on a cost code
 * that carries a different rate, a large pass-through, a credit. So it speaks
 * only when the gap is BOTH wide enough to be real AND worth money:
 *
 *   • no norms, or too few months for this customer ⇒ nothing at all. No
 *     baseline is no signal, never a quiet pass;
 *   • the rate must be off by more than `minPointsOff` percentage points;
 *   • and that gap must be worth more than `minDollarsOff` on this month's
 *     cost, so a wide swing on a tiny month stays silent.
 *
 * It is a warning and stays one. It reasons from a pattern, and a pattern is a
 * reason to look at an invoice — never a verdict on it.
 *
 * Reports in BOTH directions. Under-billing is the loss, but over-billing a
 * client is the one that costs trust and gets noticed by them first.
 */
import { defineMonthCheck } from "../checkTypes";
import { customerKey } from "../norms";
import { cents, findingKey, money, type Finding } from "../types";

export interface MarkupDriftConfig {
  /** The customer must have been invoiced in at least this many prior months. */
  minMonthsSeen: number;
  /** How far off the usual rate, in percentage points, before it is worth saying. */
  minPointsOff: number;
  /** And worth at least this much on the month's cost. */
  minDollarsOff: number;
  /** The month's cost basis must be at least this, so a trivial month can't
   *  produce a wild ratio and a confident-sounding finding. */
  minMonthCost: number;
}

/** Markup ratio (1.22) as a percentage for a human ("22%"). */
function pct(ratio: number): string {
  return `${((ratio - 1) * 100).toFixed(1)}%`;
}

export const markupDriftCheck = defineMonthCheck<MarkupDriftConfig>({
  id: "markup-drift",
  title: "Markup off this customer's usual rate",
  description:
    "The blended markup billed to a customer this month is off what they are normally charged.",
  kinds: ["markup-rate-drift"],
  /**
   * MONTH-scoped, and it has to be. A customer's rate is one number across
   * everything billed to them, so a customer with three jobs must produce ONE
   * finding — running this per job would emit three identical ones, since the
   * arithmetic and the key are both per customer.
   */
  scope: "month",
  run({ config, month }) {
    const out: Finding[] = [];
    const norms = month.norms;
    if (!norms || !norms.customers.length) return out;

    // This month's totals per customer, across every job of theirs. Ascent's
    // own overhead is never billed to anyone and has no markup, so it is left
    // out entirely rather than diluting a real customer's rate.
    const thisMonth = new Map<string, { name: string; cost: number; price: number }>();
    for (const job of month.jobs) {
      if (job.neverInvoiced) continue;
      const key = customerKey(job.customerName);
      if (!key) continue;
      const t = thisMonth.get(key) ?? { name: job.customerName, cost: 0, price: 0 };
      for (const inv of job.invoices) {
        t.cost += inv.cost;
        t.price += inv.price;
      }
      thisMonth.set(key, t);
    }

    for (const [key, actualTotals] of thisMonth) {
      const norm = norms.customers.find((c) => c.key === key);
      if (!norm || norm.monthsSeen < config.minMonthsSeen) continue;

      const cost = actualTotals.cost;
      const price = actualTotals.price;
      if (cost < config.minMonthCost || price <= 0) continue;

      const actual = price / cost;
      const pointsOff = (actual - norm.typicalMarkup) * 100;
      if (Math.abs(pointsOff) < config.minPointsOff) continue;

      // What the gap is worth: this month's price at the usual rate, against
      // the price actually billed.
      const wouldHaveBeen = cents(cost * norm.typicalMarkup);
      const gap = cents(cents(price) - wouldHaveBeen);
      if (Math.abs(gap) < config.minDollarsOff) continue;

      const name = norm.name || actualTotals.name;
      const under = gap < 0;
      out.push({
        jobId: "",
        jobName: "",
        customerName: name,
        invoiceId: "",
        invoiceNumber: "",
        // Keyed on the CUSTOMER and the month, never a job — this is one
        // finding about a rate, however many jobs it was billed across.
        key: findingKey("markup-rate-drift", "customer", `${key}|${month.ym}`),
        kind: "markup-rate-drift",
        severity: "warning",
        title: `${name} billed at ${pct(actual)}, usually ${pct(norm.typicalMarkup)}`,
        detail:
          `${month.monthLabel} for ${name} totals ${money(price)} on ` +
          `${money(cost)} of cost — a markup of ${pct(actual)}. Over the last ` +
          `${norm.monthsSeen} month${norm.monthsSeen === 1 ? "" : "s"} they have been billed ` +
          `about ${pct(norm.typicalMarkup)}. At their usual rate this month would have been ` +
          `${money(wouldHaveBeen)}, so it is ${money(Math.abs(gap))} ` +
          `${under ? "LOWER" : "higher"} than usual. ` +
          (under
            ? `If the rate wasn't meant to change, that is revenue that hasn't been billed.`
            : `Worth checking before it goes out — an unexplained rise is the kind of thing a ` +
              `client notices and asks about.`) +
          ` A month weighted toward work that carries a different rate can do this innocently.`,
        amount: Math.abs(gap),
        sourceLink: `/invoice-review?ym=${month.ym}`,
        sourceLabel: "This month's invoices",
      });
    }

    return out;
  },
});
