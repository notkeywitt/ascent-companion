/**
 * ONE VENDOR DOCUMENT BOOKED ON TWO JOBS.
 *
 * Found in the 2026-10-19 dry run on live Berger data: Sunset credits of
 * −$83.03 (7/9) and −$17.99 (7/28) itemized on Bunkhouse (tickets 690843 and
 * 696171) and booked again on Main House as one-line "QBO Vendor Credit" bills.
 * Each job's own duplicate check sees half of the pair, so neither can say it.
 *
 * Month-scoped, because the question is about the org's bills, not one job's.
 * So it runs in the monthly review and the scheduled runs, never in the
 * one-job "Check this job" gate. Same vendor, same cents, issued within
 * `windowDays`, on two different jobs — and not two bills that each carry a
 * different vendor invoice number. Warning: a vendor can genuinely bill two
 * jobs the same figure the same week, and a ruling silences that.
 */
import { defineMonthCheck } from "../checkTypes";
import { findingKey, money, type BillRef, type Finding, type JobEvidence } from "../types";
import { dayNumber, numbersAllowSame, vendorKey } from "./duplicateWide";
import { billLink } from "./shared";

export interface DuplicateCrossJobConfig {
  /** How far apart the two copies may be issued. */
  windowDays: number;
  /** Below this a same-figure pair across jobs is coincidence. */
  minCost: number;
}

export const duplicateCrossJobCheck = defineMonthCheck<DuplicateCrossJobConfig>({
  id: "duplicate-cross-job",
  title: "Same bill on two jobs",
  description: "No vendor bill or credit is booked on two jobs at once.",
  kinds: ["bill-duplicate-cross-job"],
  scope: "month",
  run({ month, config, global }) {
    const out: Finding[] = [];
    const rows: { bill: BillRef; job: JobEvidence; current: boolean }[] = [];
    for (const job of month.jobs) {
      for (const bill of [...job.bills, ...job.draftBills]) rows.push({ bill, job, current: true });
      for (const bill of job.priorBills ?? []) rows.push({ bill, job, current: false });
    }
    const seen = new Set<string>();
    for (const a of rows) {
      if (!a.current || Math.abs(a.bill.cost) < config.minCost) continue;
      for (const b of rows) {
        if (b.job.jobId === a.job.jobId) continue;
        if (vendorKey(a.bill) === "" || vendorKey(a.bill) !== vendorKey(b.bill)) continue;
        if (Math.abs(a.bill.cost - b.bill.cost) > global.tolerance) continue;
        if (Math.abs(dayNumber(a.bill.issueDate) - dayNumber(b.bill.issueDate)) > config.windowDays) continue;
        if (!numbersAllowSame(a.bill, b.bill)) continue;
        const pairKey = [a.bill.id, b.bill.id].sort().join("|");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const what = a.bill.cost < 0 ? "credit" : "bill";
        const side = (x: typeof a) =>
          `${x.job.jobName || x.job.jobId} (${x.bill.label}, ${x.bill.issueDate}, ${x.bill.status})`;
        out.push({
          jobId: a.job.jobId,
          jobName: a.job.jobName,
          customerName: a.job.customerName,
          invoiceId: "",
          invoiceNumber: "",
          key: findingKey("bill-duplicate-cross-job", a.job.jobId, pairKey),
          kind: "bill-duplicate-cross-job",
          severity: "warning",
          title: `${a.bill.vendor} ${money(a.bill.cost)} ${what} on two jobs`,
          detail:
            `The same ${a.bill.vendor} ${what} for ${money(a.bill.cost)} is booked on ${side(a)} ` +
            `and on ${side(b)}. One document belongs to one job: void the copy on the wrong ` +
            `job (deny it after removing its payments; never delete it). If the vendor really ` +
            `billed both jobs this figure, record a ruling.`,
          amount: Math.abs(a.bill.cost),
          sourceLink: billLink(a.job.jobId, a.bill.id),
          target: { kind: "bill", billId: a.bill.id },
          sourceLabel: "Open the bill",
        });
      }
    }
    return out;
  },
});
