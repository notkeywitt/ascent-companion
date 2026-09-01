/**
 * WAS THE MONTH CLOSED WITH BILLS STILL IN DRAFT?
 *
 * JobTread cannot pull a draft bill onto an invoice at all, so anything left in
 * the coding queue when the month closed was not billed — whether or not anyone
 * meant it that way. A warning, not an error: holding a bill back over a
 * question is a normal thing to do deliberately.
 *
 * Skips Ascent's own overhead jobs for the same reason `uninvoiced` does.
 */
import { defineJobCheck } from "../checkTypes";
import { findingKey, money, type Finding } from "../types";

export type DraftBillsConfig = Record<string, never>;

export const draftBillsCheck = defineJobCheck<DraftBillsConfig>({
  id: "draft-bills",
  title: "Still in draft",
  description: "No bill for the month was left in the coding queue, where it cannot be invoiced.",
  kinds: ["scope-drafts"],
  scope: "job",
  run({ job, month }) {
    const out: Finding[] = [];
    if (job.draftBillCount <= 0 || job.neverInvoiced) return out;

    out.push({
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      key: findingKey("scope-drafts", job.jobId, month.ym),
      kind: "scope-drafts",
      severity: "warning",
      invoiceId: "",
      invoiceNumber: "",
      title: `${job.draftBillCount} bill${job.draftBillCount > 1 ? "s" : ""} still in draft — ${money(job.draftBillsCost)}`,
      detail:
        `${money(job.draftBillsCost)} across ${job.draftBillCount} draft bill` +
        `${job.draftBillCount > 1 ? "s" : ""} is still in the coding queue for ` +
        `${month.monthLabel}. JobTread cannot pull a draft onto an invoice, so none of it ` +
        `was billed.`,
      amount: job.draftBillsCost,
      sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}&ym=${month.ym}`,
      sourceLabel: "Open the tracking sheet",
    });
    return out;
  },
});
