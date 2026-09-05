/**
 * Check "draft-bills-past-cutoff" (Billing) — draft vendor bills left over from
 * a billing month that has already closed.
 *
 * WHY NOT JUST "ANY DRAFT". Drafts are the normal, healthy state of a bill for
 * most of a month: it arrives, it sits in the coding queue, somebody codes it,
 * and it's approved before the monthly cutoff. Flagging every draft would flag
 * the work in progress every single morning and teach the office to ignore this
 * check. So the test is the one that actually means something went wrong: the
 * bill's billing month has CLOSED and the bill is still a draft — nobody
 * approved it, nobody denied it, and it did not make it onto the client invoice
 * for the month it belongs to.
 *
 * WHICH MONTH IS OPEN. A bill's billing period is the month of its JobTread
 * `issueDate` (the appscript mirror keeps that true). Today's arrivals land in
 * the previous month up to and including the cutoff day, so before the cutoff
 * the previous month is still open and only the month before it is late. That
 * is `openPeriod` below — the same 10th-inclusive rule as lib/billing.ts.
 *
 * READ-ONLY: one org-wide JobTread query, no writes.
 */
import { companyDateParts } from "@/lib/billing";
import { getAllDraftBills } from "@/lib/jobtread";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { DraftBillsPastCutoffConfig } from "../settings";

/** Year+month as a single comparable integer: 2026-08 → 202608. */
const periodKey = (year: number, month: number) => year * 100 + month;

/** `deltaMonths` away from a year+month, as a period key. Negative goes back. */
function shiftPeriod(year: number, month: number, deltaMonths: number): number {
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  return periodKey(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

/**
 * The billing period today's arrivals belong to — i.e. the newest period still
 * open for coding. Exported for the test.
 */
export function openBillingPeriod(now: Date, cutoffDay: number): number {
  const { year, month, day } = companyDateParts(now);
  if (day <= cutoffDay) {
    return month === 1 ? periodKey(year - 1, 12) : periodKey(year, month - 1);
  }
  return periodKey(year, month);
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

export const draftBillsPastCutoffCheck = defineCheck<DraftBillsPastCutoffConfig>({
  id: "draft-bills-past-cutoff",
  title: "Draft Bills Past Cutoff",
  category: "billing",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as DraftBillsPastCutoffConfig,

  async run({ config, pave, now, log, settings }): Promise<CheckResult> {
    if (!pave?.grantKey) return checkError("JobTread isn't configured, so drafts can't be read.");

    let drafts;
    try {
      drafts = await getAllDraftBills(pave);
    } catch (e) {
      return checkError(`Couldn't read draft bills from JobTread: ${e instanceof Error ? e.message : String(e)}`);
    }
    const cutoffDay = settings.billingCutoffDay;
    const open = openBillingPeriod(now, cutoffDay);
    const { year: ty, month: tm } = companyDateParts(now);
    const oldestAllowed = shiftPeriod(ty, tm, -config.maxMonthsBack);
    log(`${drafts.length} draft bill(s) in JobTread; billing periods before ${open} are closed (cutoff day ${cutoffDay})`);

    const items: DigestItem[] = [];
    let belowMin = 0;
    let tooOld = 0;
    let total = 0;
    for (const b of drafts) {
      const issue = String(b.issueDate ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}/.test(issue)) continue; // no date = can't place it in a period
      const y = Number(issue.slice(0, 4));
      const m = Number(issue.slice(5, 7));
      const key = periodKey(y, m);
      if (key >= open) continue; // still in an open month — normal
      if (key < oldestAllowed) {
        tooOld++;
        continue;
      }
      // `cost` is the whole bill: JobTread carves the tax OUT of the total for
      // display, it never adds it on top, and the 88 80 00 tax line is one of the
      // cost items summed into it. Adding the tax field again double-counted it.
      const amount = b.cost ?? 0;
      if (amount < config.minAmount) {
        belowMin++;
        continue;
      }
      total += amount;
      const label = `${MONTHS[m] ?? m} ${y}`;
      items.push({
        title: `${b.fromName || b.subject || b.name || "Untitled bill"} — ${money(amount)}`,
        detail:
          `Still a draft, but its billing month (${label}) closed on the ${cutoffDay}th of the following month. ` +
          `Job: ${b.jobName || "unassigned"}. Issue date ${issue}.` +
          (b.externalId ? ` Invoice ${b.externalId}.` : ""),
        sourceLink: b.jobId ? `https://app.jobtread.com/jobs/${b.jobId}/documents/${b.id}` : `/bill/${b.id}`,
        sourceLabel: b.jobId ? "Open in JobTread" : "Open bill",
        amount,
        date: issue,
        group: label,
      });
    }

    if (belowMin) log(`${belowMin} overdue draft(s) under the ${money(config.minAmount)} minimum were not listed`);
    if (tooOld) log(`${tooOld} draft(s) older than ${config.maxMonthsBack} months were not listed`);

    items.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (b.amount ?? 0) - (a.amount ?? 0));
    if (items.length === 0) {
      return allClear(`No draft bills left over from a closed billing month (${drafts.length} draft${drafts.length === 1 ? "" : "s"} in progress).`);
    }
    return {
      status: "warning",
      items,
      summary: `${items.length} draft bill${items.length === 1 ? "" : "s"} worth ${money(total)} from billing months that already closed.`,
    };
  },
});
