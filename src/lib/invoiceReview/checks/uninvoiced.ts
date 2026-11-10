/**
 * DID EVERYTHING CAPTURED THIS MONTH REACH AN INVOICE?
 *
 * Three findings, one question, and they share a structure that only makes
 * sense together: a job with NO invoice at all gets one job-level finding (
 * listing all twenty bills would bury the actual fact, which is that nobody
 * billed this job), while a job that WAS invoiced gets one finding per bill
 * left off, because naming the individual bill is what makes it a one-minute
 * fix. Labor has no per-entry equivalent, so it keeps the rolled-up form.
 *
 * ASCENT'S OWN OVERHEAD JOBS ARE SKIPPED OUTRIGHT. Cost lands on Office and
 * Shop exactly like a real job, and none of it is ever billed to anyone, so
 * without the guard these would fire on them every month forever. Never report
 * Office or Shop as under-billed.
 *
 * A JOBTREAD DRAFT IS NOT A BUILT INVOICE — in the monthly review. The office
 * stages each month's invoice in the app (a virtual invoice from the month's
 * bills and labor) and creates it in JobTread last, because JobTread does not
 * carry later bill edits into an invoice that already exists. So during the
 * review window, "no JobTread invoice yet" is the normal state, not a miss
 * (owner, 2026-11-10). The monthly review therefore counts only non-draft
 * invoices, and never reports a job as not invoiced. The pre-send gate runs at
 * the moment the invoice IS being built, so it sets `countDraftInvoices` and
 * judges the draft in hand.
 */
import { defineJobCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";
import { billLink } from "./shared";

export interface UninvoicedConfig {
  /** Below this, an "unbilled remainder" is rounding, not a missed charge. */
  remainderFloor: number;
  /**
   * Whether a JobTread DRAFT invoice counts as the job's invoice. Off for the
   * monthly review (drafts and missing invoices are staging, not misses); on
   * for the pre-send gate, which checks the invoice being built.
   */
  countDraftInvoices?: boolean;
}

export const uninvoicedCheck = defineJobCheck<UninvoicedConfig>({
  id: "uninvoiced",
  title: "Captured but not billed",
  description: "Every finalized bill and every hour captured for the month reached a client invoice.",
  kinds: ["job-not-invoiced", "bill-uninvoiced", "scope-uninvoiced"],
  scope: "job",
  run({ config, job, month }) {
    const out: Finding[] = [];
    if (job.neverInvoiced) return out;

    const base = { jobId: job.jobId, jobName: job.jobName, customerName: job.customerName };
    const floor = config.remainderFloor;

    const counted = config.countDraftInvoices
      ? job.invoices
      : job.invoices.filter((i) => i.status !== "draft");

    const uninvoiced = job.bills.filter((b) => !b.invoiced);
    const uninvoicedCost = cents(uninvoiced.reduce((s, b) => s + b.cost, 0));

    if (!counted.length && config.countDraftInvoices && uninvoicedCost > floor) {
      // No invoice at all: ONE finding for the job.
      out.push({
        ...base,
        key: findingKey("job-not-invoiced", job.jobId, month.ym),
        kind: "job-not-invoiced",
        severity: "error",
        invoiceId: "",
        invoiceNumber: "",
        title: `${job.jobName || job.customerName} — never invoiced for ${month.monthLabel}`,
        detail:
          `${uninvoiced.length} finalized bill${uninvoiced.length === 1 ? "" : "s"} totalling ` +
          `${money(uninvoicedCost)} were captured for ${month.monthLabel}, and no client ` +
          `invoice was raised for this job at all. Either the month was missed or the job ` +
          `is deliberately not billed — if it is the latter, set this aside and it will ` +
          `stop asking.`,
        amount: uninvoicedCost,
        sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}&ym=${month.ym}`,
        sourceLabel: "Open the tracking sheet",
      });
    } else if (counted.length) {
      // The job WAS invoiced, so a bill left off is a straggler — and naming
      // the individual bill is what makes it fixable in under a minute.
      for (const bill of uninvoiced) {
        if (Math.abs(bill.cost) <= floor) continue;
        out.push({
          ...base,
          key: findingKey("bill-uninvoiced", job.jobId, bill.id),
          kind: "bill-uninvoiced",
          severity: "error",
          invoiceId: "",
          invoiceNumber: "",
          title: `Captured but not billed — ${bill.vendor || bill.label} ${money(bill.cost)}`,
          detail:
            `${bill.vendor || bill.label} (${money(bill.cost)}, ${bill.status}) was captured ` +
            `for ${month.monthLabel} but sits on no client invoice, even though this job WAS ` +
            `invoiced this month. That cost is absorbed unless it was held back on purpose.`,
          amount: bill.cost,
          sourceLink: billLink(job.jobId, bill.id),
          target: { kind: "bill", billId: bill.id },
          sourceLabel: "Open the bill",
        });
      }
    }

    // Time has no per-entry equivalent here, so it keeps the rolled-up form.
    if (counted.length && job.uninvoicedTimeCost > floor) {
      out.push({
        ...base,
        key: findingKey("scope-uninvoiced", job.jobId, month.ym),
        kind: "scope-uninvoiced",
        severity: "error",
        invoiceId: "",
        invoiceNumber: "",
        title: `${money(job.uninvoicedTimeCost)} of ${month.monthLabel} labor never billed`,
        detail:
          `${money(job.uninvoicedTimeCost)} of time logged in ${month.monthLabel} sits on no ` +
          `live client invoice, even though this job WAS invoiced this month.`,
        amount: job.uninvoicedTimeCost,
        sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}&ym=${month.ym}`,
        sourceLabel: "Open labor review",
        // The same test uninvoicedTimeCost sums over — on no invoice, draft included.
        target: {
          kind: "labor",
          entryIds: job.labor.filter((t) => t.invoiceIds.length === 0).map((t) => t.id),
        },
      });
    }

    return out;
  },
});
