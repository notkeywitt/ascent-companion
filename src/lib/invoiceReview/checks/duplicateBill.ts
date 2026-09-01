/**
 * IS THE SAME VENDOR BILL ON TWO CLIENT INVOICES?
 *
 * The finding most likely to cost real money and real trust: unless one of the
 * two is a credit, the client has been billed for the same charge twice. Kept
 * as its own check because it is the one thing here that can be true with every
 * other check passing — the math foots on both invoices, the backup matches on
 * both, and the charge is simply on both.
 */
import { defineJobCheck } from "../checkTypes";
import { findingKey, money, type Finding } from "../types";
import { billLink } from "./shared";

export type DuplicateBillConfig = Record<string, never>;

export const duplicateBillCheck = defineJobCheck<DuplicateBillConfig>({
  id: "duplicate-bill",
  title: "Billed twice",
  description: "No vendor bill is carried by more than one live client invoice.",
  kinds: ["scope-duplicate-bill"],
  scope: "job",
  run({ job }) {
    const out: Finding[] = [];
    const base = { jobId: job.jobId, jobName: job.jobName, customerName: job.customerName };

    for (const bill of job.bills) {
      if (bill.invoiceIds.length < 2) continue;
      out.push({
        ...base,
        key: findingKey("scope-duplicate-bill", job.jobId, bill.id),
        kind: "scope-duplicate-bill",
        severity: "error",
        invoiceId: "",
        invoiceNumber: "",
        title: `Billed twice — ${bill.vendor || bill.label} ${money(bill.cost)}`,
        detail:
          `${bill.vendor || bill.label} (${money(bill.cost)}) sits on ${bill.invoiceIds.length} ` +
          `live client invoices at once. Unless one is a credit, the client has been billed ` +
          `for it more than once.`,
        amount: bill.cost,
        sourceLink: billLink(job.jobId, bill.id),
        sourceLabel: "Open the bill",
      });
    }
    return out;
  },
});
