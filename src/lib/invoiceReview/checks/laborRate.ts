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
 *   spread   one COST CODE carrying more than one labor rate in the month. See
 *            below — this is the one that reaches the tracking sheets.
 *
 * ## The cost-code spread, and why it is a proxy
 *
 * The tracking sheets price labor by SCOPE — one contract rate per cost code,
 * from each project's "Service Cost References" tab. JobTread prices it by
 * PERSON. Those are different quantities, and the app cannot read the sheet's
 * rate table from here, so it cannot compare them directly.
 *
 * What it CAN see is the fingerprint of the disagreement: a cost code the sheet
 * prices at one rate, carrying two in JobTread. That is nearly always somebody
 * picking the wrong pay type for the scope they worked.
 *
 * Confirmed on Ferron / Otis Perkins Addition, August 2026. Nine of the job's
 * ten codes carried exactly one rate; `01 31 10` (Project Management & Lead
 * Carpenter) carried two — Ty O'Steen at $85, the code's contract rate, and
 * Cedar at $75 under plain "Regular Pay" despite holding a "Lead" pay type at
 * $85. That one code was the ENTIRE $229 gap against the sheet, and every
 * per-person check passed because $75 is genuinely Cedar's Regular Pay rate.
 *
 * It is a warning and it says "look", not "fix": a genuinely mixed crew on one
 * code — a lead and a laborer framing together — is legitimate and will fire
 * here. The finding names who is at which rate so that call takes one glance.
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
import { findingKey, money, withinTolerance, type Finding, type LaborEntryRef } from "../types";

export interface LaborRateConfig {
  /**
   * Ignore a variance worth less than this. A rate that moved by a few cents on
   * a fifteen-minute entry is noise; a rate that moved by $10 across 89 hours is
   * the finding. Dollars of COST difference, not dollars per hour.
   */
  minVarianceCost: number;
  /** Report entries whose pay type is missing from the person's membership. */
  reportUnknownTypes: boolean;
  /**
   * Report a cost code carrying more than one labor rate in the month — the
   * proxy for the tracking sheets' per-code contract rate. Turn off if mixed
   * crews on one code are normal enough here to make it noise.
   */
  reportCodeRateSpread: boolean;
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
  kinds: [
    "labor-rate-stale",
    "labor-rate-split",
    "labor-rate-unknown",
    "labor-rate-code-spread",
  ],
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

    /**
     * (person|pay type) → the rate it will carry once the per-person finding
     * below is acted on. The cost-code loop re-prices these before deciding
     * whether a code really has two rates, so it never re-reports a spread that
     * is only there because somebody's rate is stale.
     */
    const willBecome = new Map<string, number>();

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
          willBecome.set(subjectOf(g.employee, g.payType), current);
          continue; // a split already says everything a stale finding would
        }
      }

      // ── stale: one rate, and it is not the current one ────────────────────
      // Compared in whole cents. `Math.abs(r - current) > tolerance` on raw
      // rates called 66% of one-cent-apart rates stale, because subtracting two
      // dollar values reintroduces the drift the tolerance is there to absorb.
      // Low exposure while pay rates stay whole dollars; wrong regardless.
      const off = rates.filter((r) => !withinTolerance(r, current, global.tolerance));
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
      willBecome.set(subjectOf(g.employee, g.payType), current);
    }

    if (!config.reportCodeRateSpread) return out;

    // ── spread: one COST CODE, more than one labor rate ────────────────────
    // The proxy for the tracking sheets' per-code contract rate — see the note
    // at the top of this file. Grouped by CODE, not by person, because that is
    // the unit the sheet prices.
    interface CodeGroup {
      code: string;
      hours: number;
      cost: number;
      /** rate → hours at it. */
      byRate: Map<number, number>;
      /** rate → who worked at it, for the detail line. */
      whoByRate: Map<number, Set<string>>;
    }
    const byCode = new Map<string, CodeGroup>();
    for (const e of job.labor) {
      if (!e.code) continue; // uncoded time is the uninvoiced check's problem
      if (e.rate <= 0) continue; // paid leave
      const g = byCode.get(e.code) ?? {
        code: e.code,
        hours: 0,
        cost: 0,
        byRate: new Map<number, number>(),
        whoByRate: new Map<number, Set<string>>(),
      };
      // The rate this entry will carry once the per-person findings above are
      // acted on. Reasoning on that, not on what is recorded today, is what
      // stops one stale rate being reported twice — once as the person's
      // problem and again as every cost code they touched.
      const rate = willBecome.get(subjectOf(e.employee, e.payType)) ?? e.rate;
      g.hours += e.hours;
      g.cost += e.hours * rate;
      g.byRate.set(rate, (g.byRate.get(rate) ?? 0) + e.hours);
      const who = g.whoByRate.get(rate) ?? new Set<string>();
      who.add(e.employee);
      g.whoByRate.set(rate, who);
      byCode.set(e.code, g);
    }

    for (const g of [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))) {
      if (g.byRate.size < 2) continue;

      // The rate carrying the most hours is the one the code is "really" being
      // worked at; price the whole code there and see what the mix costs.
      const ranked = [...g.byRate.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
      const dominant = ranked[0][0];
      const atDominant = g.hours * dominant;
      const variance = Math.abs(g.cost - atDominant);
      if (variance < config.minVarianceCost) continue;

      const mix = ranked
        .map(
          ([rate, hours]) =>
            `${[...(g.whoByRate.get(rate) ?? [])].sort().join(", ")} ${hrs(hours)} at ${perHour(rate)}`,
        )
        .join("; ");

      out.push({
        jobId: job.jobId,
        jobName: job.jobName,
        customerName: job.customerName,
        key: findingKey("labor-rate-code-spread", job.jobId, g.code),
        kind: "labor-rate-code-spread",
        severity: "warning",
        invoiceId: "",
        invoiceNumber: "",
        title: `${g.code}: ${g.byRate.size} labor rates on one cost code`,
        detail:
          `${g.code} carries ${mix}. The tracking sheet prices a cost code at ONE rate, so a ` +
          `code with two will not reconcile against it. Priced entirely at ${perHour(dominant)} ` +
          `the code's ${hrs(g.hours)} would be ${money(atDominant)} against ${money(g.cost)} — ` +
          `${money(variance)} apart. Usually somebody picked the wrong pay type for the scope; a ` +
          `genuinely mixed crew on one code is fine and can be ruled out. Rates already reported ` +
          `above are counted here at the rate they will carry once those are fixed, so this is ` +
          `what would still be left.`,
        amount: variance,
        sourceLink: link,
        sourceLabel: "Open Labor Review",
      });
    }

    return out;
  },
});
