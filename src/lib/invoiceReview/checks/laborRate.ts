/**
 * IS THE MONTH'S LABOR COSTED AT THE RATE IT SHOULD BE?
 *
 * ## The failure this exists for
 *
 * JobTread SNAPSHOTS the hourly rate onto a time entry when the entry is
 * written, and never revisits it. Raising someone's pay rate changes what their
 * NEXT entry costs and leaves every existing entry exactly where it was.
 *
 * Probe-confirmed on Berger Bunkhouse, August 2026: two people's entries were
 * still costed at $65 weeks after their membership had been raised to $75, and
 * a third person's "Regular Pay" carried $75 on six entries and $85 on five
 * others inside the same month. Nothing in JobTread's UI says so — the entries
 * look identical, and the only symptom is a monthly total that will not
 * reconcile against a rate table. That month was out by $1,096.75 and it took
 * a hand reconciliation against the tracking sheet to find out why.
 *
 * ## The three things it looks for
 *
 *   stale    an entry's stored rate ≠ what that pay type carries on the
 *            person's membership today. The rate was changed after the fact.
 *            This is the one that catches a raise applied mid-month.
 *   split    one person + one pay type at two different rates inside the month.
 *            Identical work costed two ways; the month cannot be reproduced
 *            from any single rate. Fires even when the membership is gone.
 *   unknown  the entry's pay type is no longer on that person's membership at
 *            all — renamed or deleted. The rate cannot be verified either way,
 *            and saying so is the point.
 *
 * ## What it deliberately does NOT do
 *
 * It does not know the contract rate for a cost code. The tracking sheets price
 * labor by SCOPE (a rate per cost code); JobTread prices it by PERSON. Those are
 * different quantities and neither is wrong, so a check that flagged every
 * disagreement between them would fire on honest, intentional work every month.
 * What it flags instead is JobTread disagreeing with ITSELF — a rate that is not
 * the rate the system currently says it is. That is always a defect.
 *
 * ## Severity
 *
 * `stale` and `split` are warnings, not errors: the money is real but the fix is
 * a judgement call (re-save the entries at the new rate, or accept that the work
 * was done under the old one). `unknown` is a warning for the same reason — it
 * reports an inability to verify, never a proven mistake.
 *
 * Skipped entirely when `month.laborRates` is null: the grant could not read
 * per-member pay types, so there is no reference to compare against. The
 * evidence loader records that as a warning, and a check that quietly passed
 * because it had nothing to check with would be worse than no check.
 */
import { defineJobCheck } from "../checkTypes";
import { findingKey, money, type Finding, type LaborEntryRef } from "../types";

export interface LaborRateConfig {
  /**
   * Ignore a variance worth less than this. A rate that moved by a few cents on
   * a fifteen-minute entry is noise; a rate that moved by $10 across 89 hours is
   * the finding. Dollars of COST difference, not dollars per hour.
   */
  minVarianceCost: number;
  /** Report entries whose pay type is missing from the person's membership. */
  reportUnknownTypes: boolean;
}

/** hours, at 1dp — the way every other labor surface here writes them. */
const hrs = (n: number) => `${n.toFixed(1)}h`;

/** "$85/hr", or "no rate" for an entry JobTread costed at zero. */
const perHour = (n: number) => (n > 0 ? `$${n.toFixed(2).replace(/\.00$/, "")}/hr` : "no rate");

/** A stable, readable id for one person + pay type, for the finding key. */
const subjectOf = (employee: string, payType: string) => `${employee}|${payType}`;

/** One (person, pay type) group inside the month. */
interface Group {
  employee: string;
  payType: string;
  entries: LaborEntryRef[];
  hours: number;
  cost: number;
  /** Distinct stored rates → hours at that rate. */
  byRate: Map<number, number>;
}

export const laborRateCheck = defineJobCheck<LaborRateConfig>({
  id: "labor-rate",
  title: "Labor rates",
  description:
    "The month's time entries are costed at the rate their pay type currently carries.",
  kinds: ["labor-rate-stale", "labor-rate-split", "labor-rate-unknown"],
  scope: "job",
  run({ job, month, config, global }) {
    const out: Finding[] = [];
    // No rate card ⇒ nothing to measure against. The loader already warned.
    if (!month.laborRates) return out;
    if (!job.labor.length) return out;

    // Group the month's entries by who worked and under which pay type. Leave
    // paid leave out: JobTread carries it at $0 by design, and a $0 rate is not
    // a costing mistake.
    const groups = new Map<string, Group>();
    for (const e of job.labor) {
      if (!e.payType) continue;
      if (e.cost === 0 && e.rate === 0) continue;
      const k = subjectOf(e.employee, e.payType);
      const g = groups.get(k) ?? {
        employee: e.employee,
        payType: e.payType,
        entries: [],
        hours: 0,
        cost: 0,
        byRate: new Map<number, number>(),
      };
      g.entries.push(e);
      g.hours += e.hours;
      g.cost += e.cost;
      g.byRate.set(e.rate, (g.byRate.get(e.rate) ?? 0) + e.hours);
      groups.set(k, g);
    }

    const link = `/labor-review?jobId=${encodeURIComponent(job.jobId)}&ym=${month.ym}`;

    for (const g of [...groups.values()].sort((a, b) => b.cost - a.cost)) {
      const card = month.laborRates.get(g.employee.trim());
      const current = card?.get(g.payType);
      const rates = [...g.byRate.keys()].sort((a, b) => a - b);

      // ── unknown: the pay type is gone from this person's membership ───────
      if (current == null) {
        if (!config.reportUnknownTypes) continue;
        out.push({
          jobId: job.jobId,
          jobName: job.jobName,
          customerName: job.customerName,
          key: findingKey("labor-rate-unknown", job.jobId, subjectOf(g.employee, g.payType)),
          kind: "labor-rate-unknown",
          severity: "warning",
          invoiceId: "",
          invoiceNumber: "",
          title: `${g.employee}: pay type “${g.payType}” no longer exists`,
          detail:
            `${hrs(g.hours)} of ${g.employee}'s time this month is costed under the pay type ` +
            `“${g.payType}” (${rates.map(perHour).join(", ")}), but that pay type is not on ` +
            `their membership any more — it was renamed or removed. The ${money(g.cost)} ` +
            `already recorded stands, but nothing can confirm the rate is the intended one, ` +
            `and new time cannot be logged against it.`,
          amount: g.cost,
          sourceLink: link,
          sourceLabel: "Open Labor Review",
        });
        continue;
      }

      // ── split: one pay type, two rates, inside one month ──────────────────
      if (rates.length > 1) {
        // What the month would cost if every hour used the current rate.
        const atCurrent = g.hours * current;
        const variance = Math.abs(g.cost - atCurrent);
        if (variance >= config.minVarianceCost) {
          const mix = rates
            .map((r) => `${hrs(g.byRate.get(r) ?? 0)} at ${perHour(r)}`)
            .join(", ");
          out.push({
            jobId: job.jobId,
            jobName: job.jobName,
            customerName: job.customerName,
            key: findingKey("labor-rate-split", job.jobId, subjectOf(g.employee, g.payType)),
            kind: "labor-rate-split",
            severity: "warning",
            invoiceId: "",
            invoiceNumber: "",
            title: `${g.employee}: “${g.payType}” billed at ${rates.length} different rates`,
            detail:
              `${g.employee}'s “${g.payType}” time this month is split ${mix}. JobTread stores ` +
              `the rate on each entry when it is written, so a rate changed mid-month leaves ` +
              `the earlier entries behind. The pay type now carries ${perHour(current)}: at ` +
              `that rate the month's ${hrs(g.hours)} would be ${money(atCurrent)}, against the ` +
              `${money(g.cost)} actually recorded — a difference of ${money(variance)}.`,
            amount: variance,
            sourceLink: link,
            sourceLabel: "Open Labor Review",
          });
          continue; // a split already says everything a stale finding would
        }
      }

      // ── stale: one rate, and it is not the current one ────────────────────
      const off = rates.filter((r) => Math.abs(r - current) > global.tolerance);
      if (off.length === 0) continue;
      const staleHours = off.reduce((s, r) => s + (g.byRate.get(r) ?? 0), 0);
      const atCurrent = staleHours * current;
      const recorded = off.reduce((s, r) => s + (g.byRate.get(r) ?? 0) * r, 0);
      const variance = Math.abs(recorded - atCurrent);
      if (variance < config.minVarianceCost) continue;

      const under = recorded < atCurrent;
      out.push({
        jobId: job.jobId,
        jobName: job.jobName,
        customerName: job.customerName,
        key: findingKey("labor-rate-stale", job.jobId, subjectOf(g.employee, g.payType)),
        kind: "labor-rate-stale",
        severity: "warning",
        invoiceId: "",
        invoiceNumber: "",
        title:
          `${g.employee}: ${hrs(staleHours)} costed at ${off.map(perHour).join("/")}, ` +
          `not ${perHour(current)}`,
        detail:
          `${g.employee}'s “${g.payType}” now carries ${perHour(current)}, but ${hrs(staleHours)} ` +
          `of this month's time is still costed at ${off.map(perHour).join(" and ")}. JobTread ` +
          `stores the rate on the entry when it is written and never re-costs it, so changing ` +
          `the rate does not reach time already logged. Those hours are recorded at ` +
          `${money(recorded)} and would be ${money(atCurrent)} at the current rate — ` +
          `${money(variance)} ${under ? "under" : "over"}. Re-save the entries to pick up the ` +
          `new rate, or leave them if the work was done under the old one.`,
        amount: variance,
        sourceLink: link,
        sourceLabel: "Open Labor Review",
      });
    }

    return out;
  },
});
