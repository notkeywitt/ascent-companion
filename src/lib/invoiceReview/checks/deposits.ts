/**
 * DEPOSIT CHECKS — DEPOSITS_PLAN.md, Stage 5. A deposit is not work: it is
 * billed on a CD ("Contract Deposit") line and drawn down by a negative CD line
 * on each later invoice. Rules: src/lib/deposits.ts.
 *
 *   deposit-overdrawn    the draws, the month's drafts included, pass the
 *                        deposit. A draft that would overdraw is caught before
 *                        it is sent.
 *   deposit-line-taxable a CD line marked taxable: the client is taxed on money
 *                        that is not a sale.
 *   deposit-line-uncoded a line named "Deposit" on another cost code: it counts
 *                        as work, and the deposit balance never sees it.
 *
 * Not built from the plan's list: `deposit-double-draw` and
 * `deposit-payment-unlinked` need payment applications, which the owner's
 * 2026-10-11 model no longer reads.
 */
import { DEPOSIT_CSI } from "@/lib/deposits";
import { defineInvoiceCheck, defineJobCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding, type InvoiceEvidence, type JobEvidence } from "../types";
import { isDepositLine } from "./shared";

export type DepositOverdrawnConfig = Record<string, never>;
export type DepositLineConfig = Record<string, never>;

const base = (job: JobEvidence, inv?: InvoiceEvidence) => ({
  jobId: job.jobId,
  jobName: job.jobName,
  customerName: job.customerName,
  invoiceId: inv?.id ?? "",
  invoiceNumber: inv?.number ?? "",
});

export const depositOverdrawnCheck = defineJobCheck<DepositOverdrawnConfig>({
  id: "deposit-overdrawn",
  title: "Deposit drawn past what is left",
  description: "No job draws more from its deposit than the deposit holds, drafts included.",
  kinds: ["deposit-overdrawn", "deposit-unrecorded"],
  scope: "job",
  run({ job, global }) {
    const d = job.deposit;
    if (!d) return [];
    const drawing = cents(d.drawn + d.onDraft);
    if (d.left == null) {
      if (drawing <= global.tolerance) return [];
      return [
        {
          ...base(job),
          key: findingKey("deposit-unrecorded", job.jobId, "deposit"),
          kind: "deposit-unrecorded",
          severity: "warning",
          title: `${money(drawing)} drawn from a deposit that is not recorded`,
          detail:
            `This job's invoices draw ${money(drawing)} on Deposit (${DEPOSIT_CSI}) lines` +
            `${d.onDraft ? `, ${money(d.onDraft)} of it on a draft` : ""}, but no deposit is recorded, ` +
            `so nothing says how much is left. Enter the deposit and what was applied before JobTread ` +
            `on the job's deposit card.`,
          amount: drawing,
          sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}`,
          sourceLabel: "Open the deposit card",
        },
      ];
    }
    const over = cents(d.onDraft - d.left);
    if (over <= global.tolerance) return [];
    return [
      {
        ...base(job),
        key: findingKey("deposit-overdrawn", job.jobId, "deposit"),
        kind: "deposit-overdrawn",
        severity: "error",
        title: `Deposit overdrawn by ${money(over)}`,
        detail:
          `Deposit ${money(d.deposit)}, previously applied ${money(d.previouslyApplied)}, drawn on sent ` +
          `invoices ${money(d.drawn)}, on drafts ${money(d.onDraft)}. That draws ${money(over)} more than ` +
          `the deposit holds, so the client is credited money they never paid. Lower the draw on the ` +
          `draft, or correct the deposit on the job's deposit card if it is wrong.`,
        amount: over,
        sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}`,
        sourceLabel: "Open the deposit card",
      },
    ];
  },
});

export const depositLineTaxableCheck = defineInvoiceCheck<DepositLineConfig>({
  id: "deposit-line-taxable",
  title: "Deposit line marked taxable",
  description: `No Deposit (${DEPOSIT_CSI}) line on a client invoice is taxable.`,
  kinds: ["deposit-line-taxable"],
  scope: "invoice",
  run({ job, invoice: inv, global }) {
    const lines = inv.lines.filter((l) => isDepositLine(l) && l.isTaxable && Math.abs(l.price) > global.tolerance);
    if (!lines.length) return [];
    const amount = cents(lines.reduce((s, l) => s + Math.abs(l.price), 0));
    return [
      {
        ...base(job, inv),
        key: findingKey("deposit-line-taxable", job.jobId, inv.id),
        kind: "deposit-line-taxable",
        severity: "warning",
        title: `Invoice #${inv.number || inv.id} — ${money(amount)} deposit line marked taxable`,
        detail:
          `A deposit is not a sale, so its ${DEPOSIT_CSI} line carries no tax. ` +
          (inv.taxRate > 0
            ? `This invoice's tax rate is ${(inv.taxRate * 100).toFixed(2)}%, so the line moves the tax by about ${money(cents(amount * inv.taxRate))}. `
            : `The invoice's tax rate is 0 today, so it charges no tax yet. `) +
          `Clear the line's taxable flag in JobTread.`,
        amount,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      },
    ];
  },
});

/** "Deposit", "Deposit draw", "Contract deposit" — not "Direct deposit". */
const DEPOSIT_NAME = /\bdeposit\b/i;
const NOT_A_DEPOSIT = /\bdirect deposit\b/i;

export const depositLineUncodedCheck = defineInvoiceCheck<DepositLineConfig>({
  id: "deposit-line-uncoded",
  title: "Deposit line on the wrong cost code",
  description: `Every line named "Deposit" on a client invoice is coded ${DEPOSIT_CSI}.`,
  kinds: ["deposit-line-uncoded"],
  scope: "invoice",
  run({ job, invoice: inv, global }) {
    const out: Finding[] = [];
    for (const l of inv.lines) {
      if (isDepositLine(l) || Math.abs(l.price) <= global.tolerance) continue;
      if (!DEPOSIT_NAME.test(l.name) || NOT_A_DEPOSIT.test(l.name)) continue;
      out.push({
        ...base(job, inv),
        key: findingKey("deposit-line-uncoded", job.jobId, l.id),
        kind: "deposit-line-uncoded",
        severity: "warning",
        title: `Invoice #${inv.number || inv.id} — "${l.name}" ${money(l.price)} is coded ${l.code || "nothing"}, not ${DEPOSIT_CSI}`,
        detail:
          `A deposit line must be coded ${DEPOSIT_CSI} (Contract Deposit). On ${l.code ? `${l.code} ${l.codeName}`.trim() : "no cost code"} ` +
          `it counts as billed work in every cost and markup figure, it posts to the wrong QuickBooks item, and ` +
          `the job's deposit balance does not see it. Recode the line to ${DEPOSIT_CSI} in JobTread, or rename it ` +
          `if it is not a deposit.`,
        amount: Math.abs(l.price),
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }
    return out;
  },
});
