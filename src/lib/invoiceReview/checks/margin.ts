/**
 * DID THE MARKUP REACH THE INVOICE? — the two failures that need no history.
 *
 * ## Why this is the check that matters most for a cost-plus builder
 *
 * Ascent bills cost plus a markup. There is no contract ceiling to breach and
 * no client-side friction about spending, so almost every way a fixed-price
 * contractor loses money on an invoice simply does not apply here. What DOES
 * apply is the one thing the whole revenue model rests on: a line that reaches
 * a client invoice at cost earns nothing, and a line billed under cost loses
 * money outright.
 *
 * Neither leaves a trace anywhere else. The invoice foots. The bill is captured.
 * The backup is filed. The client pays it without a murmur, because there is
 * nothing wrong with it from their side — it is just quietly the wrong number.
 *
 * ## Two findings, one pass, no history needed
 *
 * Unlike `markupDrift`, this check compares a line against ITSELF: its own cost
 * versus its own price. That is a fact available the first time a month is
 * reviewed, which is why it lives apart from the drift check — one is arithmetic
 * and the other is a pattern, and they should be able to be trusted, tuned and
 * turned off independently.
 *
 * ## What it refuses to guess about
 *
 * The false-positive risk here is entirely about lines with NO COST RECORDED.
 * JobTread holds 0 for a flat-priced line, and reading that as "billed at zero
 * cost" would fire this check on every deposit, allowance draw and lump-sum
 * line on every invoice — which is exactly the flood that gets a review
 * ignored. So a line only takes part when it has a real cost AND a real price,
 * both above a floor, and credits (either side negative) are skipped outright
 * because markup on a credit is a different question this check does not ask.
 *
 * Cost codes the office bills at cost on purpose — permits, fees, pass-through
 * charges — belong in `passThroughCodes` in settings.ts, not in a ruling per
 * line per month.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { cents, centsGap, findingKey, money, type Finding } from "../types";

export interface MarginConfig {
  /** A line must have cost and price above this to be judged. Keeps rounding
   *  and trivia out of a check about revenue. */
  minLineCost: number;
  /**
   * CSI cost-code number prefixes billed at cost ON PURPOSE — permits, fees,
   * pass-throughs. Matched as a prefix, so "01 41" covers everything under it.
   * This is the pressure valve that stops the office ruling on the same line
   * every month forever.
   */
  passThroughCodes: string[];
  /** Report a line billed at cost. */
  reportMissingMarkup: boolean;
  /** Report a line billed for less than it cost. */
  reportBelowCost: boolean;
}

function isPassThrough(code: string, prefixes: string[]): boolean {
  const c = String(code ?? "").trim();
  if (!c) return false;
  return prefixes.some((p) => {
    const t = String(p ?? "").trim();
    return t.length > 0 && c.startsWith(t);
  });
}

export const marginCheck = defineInvoiceCheck<MarginConfig>({
  id: "margin",
  title: "Markup reached the invoice",
  description:
    "No line was billed at cost or below it — for a cost-plus job the markup is the revenue.",
  kinds: ["markup-missing", "billed-below-cost"],
  scope: "invoice",
  run({ config, global, job, invoice: inv }) {
    const out: Finding[] = [];
    const TOL = global.tolerance;
    const base = {
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
    };
    const label = `Invoice #${inv.number || inv.id}`;

    for (const line of inv.lines) {
      const cost = cents(line.cost);
      const price = cents(line.price);

      // No cost recorded is NOT zero cost. A flat-priced line, a deposit, an
      // allowance draw — JobTread holds 0 for all of them, and judging those
      // would fire on most lines of most invoices.
      if (cost < config.minLineCost || price < config.minLineCost) continue;
      // Credits and reversals: markup on a negative is a different question.
      if (cost <= 0 || price <= 0) continue;
      if (isPassThrough(line.code, config.passThroughCodes)) continue;

      const where = line.code ? `${line.code} ${line.name}`.trim() : line.name || "an uncoded line";

      // WHOLE CENTS, because the two tests below have to partition. Asked in
      // dollars — `price < cost - TOL` here and `Math.abs(price - cost) <= TOL`
      // for at-cost — they disagree on a line priced exactly one cent under
      // cost: 20.6% were wrongly called below cost, and 38.1% satisfied NEITHER
      // and so were reported by nothing at all. That second half is the bad
      // one: a line billed at cost is the dropped markup this check exists to
      // find, and it was being silently lost. Integers cannot leave a gap.
      const underByC = centsGap(cost, price); // > 0 when billed under cost
      const tolC = centsGap(TOL, 0);

      if (config.reportBelowCost && underByC > tolC) {
        out.push({
          ...base,
          key: findingKey("billed-below-cost", job.jobId, `${inv.id}:${line.id}`),
          kind: "billed-below-cost",
          // Warning, not error, until the precision figures say otherwise —
          // every new check ships this way (see settings.ts). It is the more
          // serious of the two in substance, and the ordering by dollars is
          // what will put it near the top regardless.
          severity: "warning",
          title: `${label} — billed under cost: ${where}`,
          detail:
            `"${line.name}" cost ${money(cost)} and is billed to the client at ` +
            `${money(price)} — ${money(cost - price)} less than it cost. On a cost-plus job ` +
            `that is a loss on the line, not just a missed markup. Either the price is wrong ` +
            `or a cost landed on this line that belongs somewhere else.`,
          amount: cost - price,
          sourceLink: inv.jtUrl,
          sourceLabel: "Open in JobTread",
        });
        continue; // Below cost supersedes "no markup" — don't say both.
      }

      if (config.reportMissingMarkup && Math.abs(underByC) <= tolC) {
        out.push({
          ...base,
          key: findingKey("markup-missing", job.jobId, `${inv.id}:${line.id}`),
          kind: "markup-missing",
          severity: "warning",
          title: `${label} — no markup: ${where}`,
          detail:
            `"${line.name}" cost ${money(cost)} and is billed to the client at exactly ` +
            `${money(price)}. The markup was dropped, so this line earns nothing. If it is ` +
            `billed at cost deliberately, add its cost code to the pass-through list rather ` +
            `than setting this aside every month.`,
          amount: cost,
          sourceLink: inv.jtUrl,
          sourceLabel: "Open in JobTread",
        });
      }
    }

    return out;
  },
});
