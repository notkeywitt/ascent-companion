/**
 * A VENDOR WHO ALWAYS BILLS, AND DIDN'T.
 *
 * ## Why this check exists
 *
 * Ascent bills cost-plus, so essentially every vendor cost gets billed on to a
 * client. That makes a missing vendor invoice missing REVENUE, not just missing
 * paperwork — and it is the one failure with no evidence anywhere in the
 * system. The mailbox sweep catches an invoice that arrived and was never
 * captured. Nothing catches an invoice that was never sent, because there is
 * nothing to catch: no email, no bill, no PDF, no line. The only trace it
 * leaves is a hole in a pattern.
 *
 * So this is the first check that reads the review's own MEMORY rather than
 * this month's evidence. It could not have been written before the history
 * existed, and it is the concrete answer to "what does keeping every run buy
 * us".
 *
 * ## Why it is a warning and stays one
 *
 * A quiet month is a completely ordinary thing. A vendor finishes on a job, a
 * supplier is between deliveries, a subcontractor invoices quarterly when the
 * work happens to fall that way. This check is a REASON TO ASK, never a
 * verdict, and its wording says so.
 *
 * Three guards keep it from becoming noise:
 *   • No norms (not enough history) ⇒ nothing at all. Not a weak signal — no
 *     signal. See norms.ts.
 *   • Only vendors who bill in at least `minMonthsRatio` of the months on
 *     record, over at least `minMonthsSeen` months. A vendor who shows up half
 *     the time missing a month means nothing.
 *   • Only vendors whose typical month is worth more than `minTypicalCost`, so
 *     the month a $12 hardware run didn't happen never reaches the office.
 *
 * Month-scoped: a vendor bills Ascent, not a job, and the same supplier turning
 * up on three jobs is one relationship with one cadence.
 */
import { defineMonthCheck } from "../checkTypes";
import { findingKey, money, type Finding } from "../types";
import { vendorKey } from "../norms";

export interface VendorSilentConfig {
  /** Of the months on record, the fraction a vendor must have billed in before
   *  their silence means anything. 0.8 = "four months in five". */
  minMonthsRatio: number;
  /** And in at least this many months outright, so a vendor with two months of
   *  history can't hit the ratio on a technicality. */
  minMonthsSeen: number;
  /** Their typical month must be worth at least this much. */
  minTypicalCost: number;
}

export const vendorSilentCheck = defineMonthCheck<VendorSilentConfig>({
  id: "vendor-silent",
  title: "A regular vendor billed nothing",
  description:
    "A vendor who invoices nearly every month has no bill this month — possibly an invoice that never arrived.",
  kinds: ["vendor-silent"],
  scope: "month",
  run({ config, month }) {
    const out: Finding[] = [];
    const norms = month.norms;
    // No baseline is NO signal. Never a quiet pass.
    if (!norms || !norms.vendors.length) return out;

    // Everyone who billed anything this month, however small.
    const billedThisMonth = new Set<string>();
    for (const job of month.jobs) {
      for (const b of job.bills) {
        const k = vendorKey(b.vendor || b.label);
        if (k) billedThisMonth.add(k);
      }
    }

    for (const v of norms.vendors) {
      if (billedThisMonth.has(v.key)) continue;
      if (v.monthsSeen < config.minMonthsSeen) continue;
      if (v.monthsSeen / v.monthsOfHistory < config.minMonthsRatio) continue;
      if (v.typicalMonthlyCost < config.minTypicalCost) continue;

      out.push({
        jobId: "",
        jobName: "",
        customerName: v.name,
        invoiceId: "",
        invoiceNumber: "",
        key: findingKey("vendor-silent", "", v.key),
        kind: "vendor-silent",
        severity: "warning",
        title: `Nothing from ${v.name} this month`,
        detail:
          `${v.name} has billed in ${v.monthsSeen} of the last ${v.monthsOfHistory} months, ` +
          `typically about ${money(v.typicalMonthlyCost)} a month, and there is no bill from ` +
          `them for ${month.monthLabel} at all. That may be a genuinely quiet month — or an ` +
          `invoice that never arrived, which nothing else here can see, because an invoice ` +
          `that was never sent leaves no trace to find. Worth one look at their account.`,
        amount: v.typicalMonthlyCost,
      });
    }

    return out;
  },
});
