/**
 * THE PRE-SEND GATE — check one job's invoice BEFORE it goes to the client.
 *
 * ## Why this exists at all
 *
 * The monthly review is a late catch. By the time it runs, the invoice may
 * already be with the customer, and every mistake it finds has to be fixed by
 * a credit, a re-issue, or a conversation. The cheapest moment to catch a
 * billing error is the moment before it is sent, which is the moment nobody was
 * checking.
 *
 * So this runs the same checks — literally the same files, no second
 * implementation — against one job, on demand, from the invoicing screen.
 *
 * ## What it deliberately does NOT check, and why that is not a shortcut
 *
 * Evidence here is scoped to ONE JOB, so the month-scoped checks are left out
 * (`scopes: ["job", "invoice"]`). That is a correctness rule, not an
 * optimisation:
 *
 *   • `vendor-silent` asks which vendors billed nothing ANYWHERE this month.
 *     Against one job, almost every vendor looks silent.
 *   • `markup-drift` sums a customer's totals across every job they have.
 *     Against one job, a customer with three gets a rate computed from a third
 *     of their work.
 *
 * Running them here would not be slower — it would be wrong. They stay in the
 * monthly review, which has the whole month to reason about, and the caller is
 * told plainly that this gate does not cover them.
 *
 * The mailbox sweep is skipped too (`email: false`): it is month-wide, it is
 * the slow half of a review, and its check reports nothing rather than passing
 * when it has not run. "Did every vendor invoice that arrived get captured" is
 * a question about the period, not about this invoice.
 *
 * ## Still read-only
 *
 * Loads, checks, applies the office's standing rulings, and returns. It files
 * nothing in the run history — a per-job spot check is not a review of the
 * month, and letting it write rows would corrupt the trend the learning layer
 * reads.
 */
import { loadMonthEvidence } from "./evidence";
import { runChecks } from "./registry";
import { applyRulings, listRulings } from "./rulings";
import type { Finding } from "./types";
import type { PaveConfig } from "@/lib/jobtread";

export interface PreSendResult {
  jobId: string;
  jobName: string;
  customerName: string;
  ym: string;
  monthLabel: string;
  /** Findings for this job, worst first, standing rulings applied. */
  findings: Finding[];
  /** Live (unsuppressed) counts, for the badge on the button. */
  errors: number;
  warnings: number;
  /** Non-fatal problems gathering the evidence. A gate that could not read the
   *  job must never render as a clean one. */
  evidenceWarnings: string[];
  /** True when the job had no bills or invoices in the month at all — there is
   *  nothing to check rather than nothing wrong. */
  empty: boolean;
}

export async function preSendCheck(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<PreSendResult> {
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  const evidence = await loadMonthEvidence(cfg, year, month, {
    email: false,
    onlyJobIds: [jobId],
  });

  const job = evidence.jobs[0];
  // Only the scopes that are meaningful against one job — see the module note.
  const raw = runChecks(evidence, undefined, { scopes: ["job", "invoice"] });

  let findings = raw;
  try {
    findings = applyRulings(raw, await listRulings());
  } catch {
    // A ruling store that cannot be read means nothing is suppressed, which
    // errs toward showing too much. Not worth failing the gate over.
  }

  const live = findings.filter((f) => !f.suppressedBy);
  return {
    jobId,
    jobName: job?.jobName ?? "",
    customerName: job?.customerName ?? "",
    ym,
    monthLabel: evidence.monthLabel,
    findings,
    errors: live.filter((f) => f.severity === "error").length,
    warnings: live.filter((f) => f.severity === "warning").length,
    evidenceWarnings: evidence.warnings,
    empty: !job || (job.bills.length === 0 && job.invoices.length === 0),
  };
}
