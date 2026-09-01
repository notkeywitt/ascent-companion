/**
 * IS THE INVOICE DATED INTO THE RIGHT MONTH?
 *
 * In JobTread the issue date IS the billing period — the month and year of
 * `issueDate` are the period the document belongs to. An invoice carrying this
 * month's bills but dated into another month therefore bills the client for the
 * wrong period, and the Apps Script mirror will re-file its backup into the
 * wrong Drive month on the next pass. One mis-typed date, two systems wrong.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { findingKey, type Finding } from "../types";

export type IssueDateConfig = Record<string, never>;

export const issueDateCheck = defineInvoiceCheck<IssueDateConfig>({
  id: "issue-date",
  title: "Billing period",
  description: "The invoice is dated inside the billing month it carries.",
  kinds: ["period-issue-date"],
  scope: "invoice",
  run({ job, month, invoice: inv }) {
    const out: Finding[] = [];
    const mm = String(month.month).padStart(2, "0");
    const first = `${month.year}-${mm}-01`;
    const lastDay = new Date(month.year, month.month, 0).getDate();
    const last = `${month.year}-${mm}-${String(lastDay).padStart(2, "0")}`;

    const issued = String(inv.issueDate ?? "").slice(0, 10);
    if (!issued || (issued >= first && issued <= last)) return out;

    out.push({
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      key: findingKey("period-issue-date", job.jobId, inv.id),
      kind: "period-issue-date",
      severity: "warning",
      title: `Invoice #${inv.number || inv.id} — dated outside ${month.monthLabel}`,
      detail:
        `This invoice carries ${month.monthLabel} bills but is issued ${issued}, outside ` +
        `${first}…${last}. In JobTread the issue date is the billing period, so this bills ` +
        `the client for the wrong month.`,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
    return out;
  },
});
