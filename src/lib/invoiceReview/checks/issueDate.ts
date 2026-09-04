/**
 * IS THE INVOICE DATED INTO THE RIGHT PERIOD?
 *
 * ⚠️ A CLIENT INVOICE IS NOT A VENDOR BILL. For a vendor BILL the issue date IS
 * the billing period — that is how `getJobBillsForMonth` assigns one to a month.
 * For the CLIENT invoice raised against those bills, the issue date is the day
 * it went out, which is NECESSARILY AFTER the period closed. This check used to
 * apply the bill rule to the invoice and demanded the issue date fall inside the
 * billing month itself.
 *
 * That is not how the office bills. `deriveBillingPeriod()` (Config.js, the
 * single source of truth) puts a bill received ON OR BEFORE THE 10th into the
 * PREVIOUS month, so July billing runs ~July 11 → Aug 10 and its invoice can
 * only be raised once that window shuts. Berger Bunkhouse's July invoice #221,
 * issued 2026-08-11, is exactly on schedule — and was reported as billing "the
 * client for the wrong month".
 *
 * So the window is the billing month plus the whole month after it. Outside
 * that, the date is genuinely wrong: dated before the period it bills, or left
 * so late the backup is re-filed into the wrong Drive month by the mirror.
 *
 * The review never assigns a period from this date — the roster is built
 * bills-first (see evidence.ts) precisely so this check has something
 * independent to compare against.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { findingKey, type Finding } from "../types";

export type IssueDateConfig = Record<string, never>;

export const issueDateCheck = defineInvoiceCheck<IssueDateConfig>({
  id: "issue-date",
  title: "Billing period",
  description: "The invoice is dated inside the period it bills — the billing month or the month after, when the period closes.",
  kinds: ["period-issue-date"],
  scope: "invoice",
  run({ job, month, invoice: inv }) {
    const out: Finding[] = [];
    const mm = String(month.month).padStart(2, "0");
    const first = `${month.year}-${mm}-01`;

    // The billing month PLUS the month after it: the period runs to the 10th of
    // the following month (deriveBillingPeriod), so the invoice is raised in
    // that following month by design. `new Date(y, m + 1, 0)` is the last day of
    // month m+1 with the year roll handled for us — December billing accepts a
    // January date.
    const afterEnd = new Date(month.year, month.month + 1, 0);
    const last =
      `${afterEnd.getFullYear()}-${String(afterEnd.getMonth() + 1).padStart(2, "0")}-` +
      `${String(afterEnd.getDate()).padStart(2, "0")}`;

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
        `${first}…${last}. The ${month.monthLabel} billing period closes on the 10th of the ` +
        `following month, so an invoice for it is raised inside that window — this one is ` +
        `${issued < first ? "dated before the period it bills" : "later than that"}.`,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
    return out;
  },
});
