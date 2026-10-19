/**
 * Check "invoice-review-window" (Billing) — where this month's invoice review
 * stands, from the 1st to send day.
 *
 * The review runs on its own (src/lib/invoiceReview/schedule.ts): early looks
 * on the 5th and 8th, then nightly from the 11th to send day on the 15th. A run
 * nobody reads changes nothing, so this puts its result where the office looks
 * every morning: the count to fix, the countdown to send day, and the findings
 * themselves, worst first.
 *
 * READ-ONLY, and cheap: one read of the companion's own run history. It never
 * starts a review — the digest's scheduler call does that.
 */
import { ensureDb } from "@/db";
import { reviewWindow } from "@/lib/invoiceReview/schedule";
import { readLatestRun } from "@/lib/invoiceReview/runs";
import { DEFAULT_SETTINGS as REVIEW_SETTINGS } from "@/lib/invoiceReview/settings";
import { compareFindings } from "@/lib/invoiceReview/types";
import { orgParts } from "@/lib/orgTime";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { InvoiceReviewWindowConfig } from "../settings";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

export const invoiceReviewWindowCheck = defineCheck<InvoiceReviewWindowConfig>({
  id: "invoice-review-window",
  title: "Invoice Review",
  category: "billing",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as InvoiceReviewWindowConfig,

  async run({ config, now, settings, log }): Promise<CheckResult> {
    // The run history is this check's one source. `readLatestRun` swallows a
    // dead database and answers "no run", which would read as "nobody ran it"
    // — so the database is opened here first, and a failure says so.
    try {
      await ensureDb();
    } catch (e) {
      return checkError(`Couldn't open the review history: ${e instanceof Error ? e.message : String(e)}`);
    }
    const w = reviewWindow(now, REVIEW_SETTINGS.schedule, settings.billingCutoffDay);
    if (!w) return allClear("No invoicing window open — the next one starts on the 1st.");

    const label = `${MONTHS[w.month]} ${w.year}`;
    const link = `/invoice-review?ym=${w.ym}`;
    const countdown =
      w.daysToSend === 0 ? "invoices go out today" : `send day is ${w.sendDate} (${w.daysToSend} day${w.daysToSend === 1 ? "" : "s"})`;
    const run = await readLatestRun(w.ym);
    if (!run) {
      log(`no filed review for ${w.ym}`);
      if (w.phase === "early") {
        return allClear(`${label} bills are still coming in until the ${settings.billingCutoffDay}th; ${countdown}. No review filed yet.`);
      }
      return {
        status: "warning",
        items: [{
          key: `invoice-review-missing|${w.ym}|${w.today}`,
          title: `No ${label} review has run yet`,
          detail: `The billing month closed on the ${settings.billingCutoffDay}th and ${countdown}, but no review is on file. Open the page and run it.`,
          sourceLink: link,
          sourceLabel: "Open Invoice Review",
        }],
        summary: `No ${label} review on file — ${countdown}.`,
      };
    }

    const live = (run.payload?.findings ?? []).filter((f) => !f.suppressedBy).sort(compareFindings);
    const errors = live.filter((f) => f.severity === "error");
    const warnings = live.filter((f) => f.severity === "warning");
    const ranAt = orgParts(run.ranAt);
    const stamp = `last run ${ranAt.date} ${ranAt.time}`;
    log(`${w.ym}: ${errors.length} to fix, ${warnings.length} to look at (${stamp})`);

    const pool = config.includeWarnings ? live : errors;
    if (pool.length === 0) {
      return allClear(`${label}: nothing to fix — ${countdown}; ${stamp}.`);
    }
    const items: DigestItem[] = pool.slice(0, config.maxItems).map((f) => ({
      key: `invoice-review|${f.key}`,
      title: f.title,
      detail: `${f.customerName}${f.jobName ? ` — ${f.jobName}` : ""}. ${f.detail}`,
      sourceLink: f.sourceLink?.startsWith("/") ? f.sourceLink : link,
      sourceLabel: f.sourceLink?.startsWith("/") ? f.sourceLabel : "Open Invoice Review",
      amount: f.amount,
      group: f.severity === "error" ? "To fix" : "To look at",
    }));
    return {
      // Before the cutoff the month is still filling, so findings are a heads-up.
      status: errors.length && w.phase !== "early" ? "error" : "warning",
      items,
      summary:
        `${label}: ${errors.length} to fix, ${warnings.length} to look at — ${countdown}; ${stamp}.` +
        (pool.length > items.length ? ` Showing ${items.length}; the rest are on the review page.` : ""),
    };
  },
});
