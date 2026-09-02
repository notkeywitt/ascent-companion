/**
 * IS A DRAFT BILL A SECOND COPY OF ONE THE JOB ALREADY HAS?
 *
 * ## Why this is its own check
 *
 * `duplicate-bill` asks whether one vendor bill reached two CLIENT INVOICES.
 * That is a question about invoices, and a draft is on no invoice at all, so it
 * cannot see this. `draft-bills` counts what is still in the coding queue but
 * never looks at what those drafts ARE. Between them a re-ingested bill sits in
 * the queue looking like ordinary unfinished work, and the moment both copies
 * are approved the job carries the charge twice.
 *
 * ## The case this was built from
 *
 * Kevin Berger / Main House, August 2026. Two drafts, both Island Custom
 * Woodworks, both issued 2026-08-31, both $4,163.75, nine identical lines each
 * down to a −$1,589.06 deposit draw. Created fourteen minutes apart. The only
 * difference was the coding: one was coded across five cost codes, the other
 * dumped onto `12 30 00`. Their `externalId`s differed — `INV-8e06f037` and
 * `INV-c1d0facc` — which is exactly why the ingestion guard, which keys on
 * that, let the second one through.
 *
 * The pre-send gate reported only "2 bills still in draft — $8,327.50". True,
 * and it reads as $8,327.50 of work to finish rather than $4,163.75 of work and
 * a duplicate to delete.
 *
 * ## What counts as a copy
 *
 * Same job, same vendor, same cost to the cent, same issue date. All four,
 * because a vendor legitimately billing the same round figure twice in a month
 * is ordinary and only the date makes the coincidence implausible. In JobTread
 * the issue date IS the billing period, so two bills sharing one is a much
 * stronger signal than a date proximity rule would be.
 *
 * A group is reported when at least one member is a DRAFT. A draft twinning an
 * already-finalized bill matters just as much as two drafts — approving it
 * double-counts against a charge the job has already taken.
 *
 * `amount` is what would be double-counted, i.e. the cost of the copies beyond
 * the first, not the group total. The finding is about the surplus.
 *
 * Zero-cost drafts are skipped: an empty shell bill created and abandoned is
 * common, matches every other empty shell, and is worth nothing.
 */
import { defineJobCheck } from "../checkTypes";
import { findingKey, money, type BillRef, type Finding } from "../types";
import { billLink } from "./shared";

export interface DuplicateDraftConfig {
  /**
   * Require the copies to share an issue date. On by default — without it a
   * vendor billing the same figure twice in a month reads as a duplicate.
   */
  requireSameIssueDate: boolean;
  /** Ignore groups worth less than this. Guards rounding-sized shells. */
  minCost: number;
}

/** Vendor names differ only in spacing/case often enough to matter. */
const vendorKey = (b: BillRef) => (b.vendor || b.label).trim().toLowerCase().replace(/\s+/g, " ");

export const duplicateDraftCheck = defineJobCheck<DuplicateDraftConfig>({
  id: "duplicate-draft",
  title: "Duplicate draft",
  description: "No draft bill is a second copy of a bill the job already has.",
  kinds: ["bill-duplicate-draft"],
  scope: "job",
  run({ job, config }) {
    const out: Finding[] = [];
    if (job.draftBills.length === 0) return out;

    // Drafts first in each group, so the finding names one to delete rather
    // than one to keep.
    const all = [...job.draftBills, ...job.bills];
    const groups = new Map<string, BillRef[]>();
    for (const b of all) {
      if (Math.abs(b.cost) < config.minCost) continue;
      const key = [
        vendorKey(b),
        b.cost.toFixed(2),
        config.requireSameIssueDate ? b.issueDate : "",
      ].join("|");
      groups.set(key, [...(groups.get(key) ?? []), b]);
    }

    const isDraft = (b: BillRef) => b.status === "draft";

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const drafts = group.filter(isDraft);
      if (drafts.length === 0) continue; // finalized twins are not this check's

      const first = group[0];
      const surplus = first.cost * (group.length - 1);
      const others = group.length - 1;
      const finalized = group.filter((b) => !isDraft(b));

      out.push({
        jobId: job.jobId,
        jobName: job.jobName,
        customerName: job.customerName,
        // Keyed on the group, not on one bill: deleting the copy must not make
        // the same finding come back under the survivor's id next month.
        key: findingKey(
          "bill-duplicate-draft",
          job.jobId,
          `${vendorKey(first)}|${first.cost.toFixed(2)}|${first.issueDate}`,
        ),
        kind: "bill-duplicate-draft",
        severity: "error",
        invoiceId: "",
        invoiceNumber: "",
        title: `Duplicate draft — ${first.vendor || first.label} ${money(first.cost)} ×${group.length}`,
        detail:
          `${group.length} bills on this job are ${first.vendor || first.label} for ` +
          `${money(first.cost)}, all issued ${first.issueDate} — ` +
          `${drafts.length} in draft` +
          (finalized.length
            ? ` and ${finalized.length} already finalized (${finalized
                .map((b) => b.status)
                .join(", ")})`
            : "") +
          `. Same vendor, same figure, same billing period: almost certainly one invoice ` +
          `captured more than once. Approving them all would put ${money(surplus)} of ` +
          `duplicate cost on the job. Check the lines, keep the one that is coded, delete ` +
          `the rest. Bills: ${group.map((b) => b.label).join(", ")}.`,
        amount: surplus,
        sourceLink: billLink(job.jobId, drafts[0].id),
        sourceLabel: "Open the draft",
      });
    }

    return out;
  },
});
