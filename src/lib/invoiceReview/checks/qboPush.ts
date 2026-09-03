/**
 * DID THE COST ACTUALLY REACH THE BOOKS?
 *
 * ── WHY THIS CHECK EXISTS ───────────────────────────────────────────────────
 * QuickBooks is the general ledger. JobTread is the source of truth for the
 * JOB, but the accounting lives in QBO, and the bridge between them is one
 * event and one flag:
 *
 *   • APPROVING a vendor bill is what pushes it to QuickBooks. `amountPaid` and
 *     `balance` then come back FROM QBO — which is why a draft reads 0/0.
 *   • `qboIsIgnored` turns that push off. It is a toggle on the bill page and on
 *     the Tracking Sheets board ("Push to QB"), so it takes one tap.
 *
 * Every other check in this review asks whether the CLIENT was billed correctly.
 * None of them asks whether Ascent's own books ever saw the cost. A bill can be
 * captured from email, coded to the right cost code, carried onto a client
 * invoice, backed by its PDF in Drive, and paid by the client — with
 * `qboIsIgnored` true the whole time. Revenue is recorded, the matching cost is
 * not, and the month's profit is overstated by exactly that amount. Nothing
 * downstream notices, because nothing downstream looks at QuickBooks.
 *
 * ── TWO FINDINGS ────────────────────────────────────────────────────────────
 *   `qbo-not-pushed`     the flag is set on a bill that is otherwise finished.
 *   `qbo-never-approved` the bill reached a client invoice while still `pending`.
 *                        Only approval pushes, so a pending bill on a live
 *                        invoice has billed the client for a cost the ledger
 *                        has not recorded.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not claim the push SUCCEEDED. JobTread does not expose a per-document
 * QBO sync result this app can read, so "approved and not ignored" is as far as
 * the evidence goes. Saying more than that would be inventing a fact — and the
 * two states above are the ones that are provably wrong from here.
 *
 * A `qboIsIgnored` of `null` means the field could not be read. That is skipped,
 * not passed: reporting a bill whose flag was never seen would be a guess.
 *
 * Job-scoped, so it also runs in the pre-send gate ("Check this job") — which is
 * the useful moment, since the fix is one tap before the invoice goes out.
 * Overhead jobs (Office, Shop) are NOT skipped here, unlike the invoicing
 * checks: their cost is never billed to a client but it absolutely belongs in
 * the books.
 */
import { defineJobCheck } from "../checkTypes";
import { findingKey, money, type Finding } from "../types";

export interface QboPushConfig {
  /**
   * Ignore a bill below this cost.
   *
   * A zero-dollar or near-zero bill excluded from QuickBooks is housekeeping,
   * not a hole in the ledger. Set to 0 to report every one of them.
   */
  minCost: number;
  /**
   * Report a bill that reached a client invoice while still `pending`.
   *
   * Separable from the flag finding because it is a different mistake with a
   * different fix — approve the bill, rather than un-tick a checkbox — and an
   * office that invoices before approving on purpose will want only the first.
   */
  reportNeverApproved: boolean;
}

export const qboPushCheck = defineJobCheck<QboPushConfig>({
  id: "qbo-push",
  title: "Reached QuickBooks",
  description:
    "Every captured cost is on its way to the general ledger — not flagged 'don't push', and not left pending on a bill the client was already invoiced for.",
  kinds: ["qbo-not-pushed", "qbo-never-approved"],
  scope: "job",
  run({ job, month, config }) {
    const out: Finding[] = [];
    const jobBits = {
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: "",
      invoiceNumber: "",
    };
    for (const bill of job.bills) {
      if (bill.cost < config.minCost) continue;

      // ── The flag ──────────────────────────────────────────────────────────
      // `null` is "could not read", which is not evidence of anything.
      if (bill.qboIsIgnored === true) {
        out.push({
          ...jobBits,
          key: findingKey("qbo-not-pushed", job.jobId, bill.id),
          kind: "qbo-not-pushed",
          severity: "error",
          title: `${bill.vendor || bill.label} — ${money(bill.cost)} is set not to push to QuickBooks`,
          detail:
            `${bill.vendor || bill.label} (${money(bill.cost)}, issued ${bill.issueDate}) has ` +
            `"Push to QuickBooks" turned off, so approving it does not send the cost to the ` +
            `general ledger. ` +
            (bill.invoiced
              ? `The client HAS been invoiced for it, so the revenue is recorded and this cost is not.`
              : `Nothing has gone to the client yet, so fixing it now costs nothing.`) +
            ` Un-tick it on the bill unless it is excluded on purpose.`,
          amount: bill.cost,
          sourceLink: `/bill/${encodeURIComponent(bill.id)}`,
          sourceLabel: "Open the bill",
        });
        continue; // one finding per bill: the flag is the bigger problem
      }

      // ── The approval ──────────────────────────────────────────────────────
      // Only "approved" pushes. A pending bill already on a live client invoice
      // means the client was billed for a cost the ledger has not taken.
      if (
        config.reportNeverApproved &&
        bill.status === "pending" &&
        bill.invoiceIds.length > 0
      ) {
        out.push({
          ...jobBits,
          key: findingKey("qbo-never-approved", job.jobId, bill.id),
          kind: "qbo-never-approved",
          severity: "warning",
          title: `${bill.vendor || bill.label} — ${money(bill.cost)} invoiced but never approved`,
          detail:
            `${bill.vendor || bill.label} (${money(bill.cost)}) is on a live client invoice for ` +
            `${month.monthLabel} but its status is still "pending". Approving a bill is what ` +
            `pushes it to QuickBooks, so the client has been billed for a cost the general ` +
            `ledger has not recorded.`,
          amount: bill.cost,
          sourceLink: `/bill/${encodeURIComponent(bill.id)}`,
          sourceLabel: "Open the bill",
        });
      }
    }

    return out;
  },
});
