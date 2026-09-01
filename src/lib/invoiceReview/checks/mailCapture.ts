/**
 * THE OFFICE MAILBOX — did every vendor invoice that arrived get captured?
 *
 * ## The question this answers
 *
 * A client invoice can only bill what JobTread knows about. An invoice that
 * arrived by email and was never filed is invisible to every other check here —
 * the math will foot, the backup will match, the totals will reconcile, and the
 * charge will simply be absent. Nothing downstream can find it, because
 * downstream only sees what got captured. The mailbox is the only place the
 * evidence still exists. That is why this is the most important check in the
 * review, and why it is month-scoped: an arriving vendor invoice belongs to the
 * PERIOD, not to whichever job it eventually landed on.
 *
 * ## Why this is trustworthy enough to flag
 *
 * The join is already done (evidence.ts, using the Daily Digest's matchers):
 * the sender is resolved to a JobTread vendor account, and a bill counts as
 * "this invoice" when its date is within three weeks of the email and — where
 * the subject printed an amount — the amounts agree within tax and rounding.
 * Lenient on purpose: a false MATCH costs nothing, because the bill really is
 * in JobTread; a false MISS costs somebody a minute.
 *
 * Two guards keep it honest:
 *   • `checked: false` means the vendor's bills could not be read, so the
 *     absence of a match proves nothing. Never flagged.
 *   • A sender matching no vendor account at all is a SEPARATE, softer finding —
 *     there is no bill list to search, so "missing" was never established. It
 *     is usually a new vendor, and sometimes not an invoice at all.
 */
import { defineMonthCheck } from "../checkTypes";
import { findingKey, money, type Finding } from "../types";

export interface MailCaptureConfig {
  /** Report invoice-looking mail from a sender matching no JobTread vendor.
   *  Never a proven miss — see the module note. */
  reportUnknownSenders: boolean;
}

export const mailCaptureCheck = defineMonthCheck<MailCaptureConfig>({
  id: "mail-capture",
  title: "Was every vendor invoice captured?",
  description: "Every vendor invoice that arrived in the billing window became a JobTread bill.",
  kinds: ["email-bill-missed", "email-unknown-sender"],
  scope: "month",
  run({ config, month }) {
    const out: Finding[] = [];
    if (!month.emailChecked) return out;

    const windowLabel = month.mailWindow
      ? `${month.mailWindow.first} to ${month.mailWindow.last}`
      : month.monthLabel;

    for (const e of month.emails) {
      const arrived = e.date.slice(0, 10);
      const amount = e.subjectAmount ?? undefined;
      const base = {
        jobId: "",
        jobName: "",
        customerName: e.vendorName || e.fromName || "Unrecognized sender",
        invoiceId: "",
        invoiceNumber: "",
        amount,
        sourceLink: e.threadUrl,
        sourceLabel: "Open the email",
      };

      // A sender with no vendor account: nothing to search, so nothing proven.
      if (!e.vendorId) {
        if (!config.reportUnknownSenders) continue;
        out.push({
          ...base,
          key: findingKey("email-unknown-sender", "", e.threadId),
          kind: "email-unknown-sender",
          severity: "warning",
          title: `Unrecognized sender — ${e.fromName || e.fromAddress || "unknown"}`,
          detail:
            `"${e.subject}" arrived ${arrived} from ${e.from}` +
            (amount ? ` showing ${money(amount)}` : "") +
            `. The sender matches no JobTread vendor account, so there is no bill list to ` +
            `check it against. Either it is a new vendor whose invoice still needs filing, ` +
            `or it is not an invoice at all.`,
        });
        continue;
      }

      // The vendor's bills couldn't be read — say nothing rather than accuse.
      if (!e.checked) continue;
      if (e.matchedBillId) continue;

      // A label claiming the invoice was handled, on an invoice that isn't in
      // JobTread, is the most telling version of this finding — say so.
      const claimed = e.labels.filter((l) => /processed|added to jt/i.test(l));

      out.push({
        ...base,
        key: findingKey("email-bill-missed", "", e.threadId),
        kind: "email-bill-missed",
        severity: "error",
        title: `Never captured — ${e.vendorName}${amount ? ` ${money(amount)}` : ""}`,
        detail:
          `"${e.subject}" arrived ${arrived} from ${e.from}` +
          (amount ? ` showing ${money(amount)}` : "") +
          `, inside the ${windowLabel} billing window, but JobTread has no ${e.vendorName} ` +
          `bill within three weeks of it` +
          (amount ? ` at a matching amount` : "") +
          `. If that invoice was real, this month was billed without it.` +
          (claimed.length
            ? ` The email is labelled "${claimed.join('", "')}", so something believed it was ` +
              `filed — that belief is what this check exists to test.`
            : "") +
          (e.attachmentCount
            ? ` ${e.attachmentCount} attachment${e.attachmentCount > 1 ? "s" : ""}.`
            : ` No attachment — may be a portal notice rather than the invoice itself.`),
      });
    }

    // An exhausted sweep is a sweep that proved nothing about what it didn't see.
    if (month.mailTruncated) {
      out.push({
        key: findingKey("email-bill-missed", "", "truncated"),
        kind: "email-bill-missed",
        severity: "warning",
        jobId: "",
        jobName: "",
        customerName: "",
        invoiceId: "",
        invoiceNumber: "",
        title: "The mailbox sweep hit its limit",
        detail:
          `Gmail returned more invoice-looking mail for ${windowLabel} than the sweep reads in ` +
          `one pass, so some of the period was not checked. Anything missed would not appear ` +
          `above — treat the capture check as partial for this month.`,
      });
    }

    return out;
  },
});
