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
 * ## Labor rates
 *
 * `labor-rate` is job-scoped, so it runs here — and it is the reason the
 * evidence loader will build a shell for a named job that has no bills at all.
 * A month whose only content is time entries still has a rate to get wrong, and
 * the roster (which is built from bills) would otherwise not carry that job.
 *
 * ## Still read-only
 *
 * Loads, checks, applies the office's standing rulings, and returns. It files
 * nothing in the run history — a per-job spot check is not a review of the
 * month, and letting it write rows would corrupt the trend the learning layer
 * reads.
 */
import { loadMonthEvidence } from "./evidence";
import { ALL_CHECKS, checkIdForKind, runChecks } from "./registry";
import { depositPart } from "./checks/shared";
import { DEFAULT_SETTINGS } from "./settings";
import { unreadParts } from "./inbox";
import { applyRulings, listRulings } from "./rulings";
import type { Finding } from "./types";
import type { ReportKeep } from "@/lib/findings";
import type { PaveConfig } from "@/lib/jobtread";

/** One check's result on this job, for the Invoice Status page's indicators. */
export interface CheckStatus {
  id: string;
  title: string;
  /** What the check tests, and the finding kinds it emits. Carried here so a
   *  browser page groups findings by check without importing the registry,
   *  which pulls server code (norms → db). Absent on runs saved before
   *  2026-11-18; a re-check fills them. */
  description?: string;
  kinds?: string[];
  /** Live (unsuppressed) findings of this check. */
  errors: number;
  warnings: number;
}

/**
 * The app's figures beside JobTread's, for one job and month. Cost basis on
 * both sides, so the invoice's markup and tax do not show up as a difference.
 */
export interface PreSendFigures {
  /** Cost on the job's non-void client invoices, deposit draws left out. */
  invoiceCost: number;
  /** What the app says the month still has to invoice: bills and time not yet
   *  on an invoice, plus the draft bills still coding. */
  toBeInvoiced: number;
  /** The invoices' total with tax: what the client is billed. */
  invoiceTotal: number;
}

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
  /** What the inbox report must leave alone: the reads that failed (inbox.ts). */
  unread?: ReportKeep;
  /** Every check this gate runs, with its live finding counts. */
  checks: CheckStatus[];
  figures: PreSendFigures;
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
  // The gate runs while the invoice is being built, so a JobTread draft IS the
  // invoice in hand (see checks/uninvoiced.ts).
  const settings = {
    ...DEFAULT_SETTINGS,
    checks: {
      ...DEFAULT_SETTINGS.checks,
      uninvoiced: {
        ...DEFAULT_SETTINGS.checks.uninvoiced,
        config: { ...DEFAULT_SETTINGS.checks.uninvoiced.config, countDraftInvoices: true },
      },
    },
  };
  const raw = runChecks(evidence, settings, { scopes: ["job", "invoice"] });

  let findings = raw;
  try {
    findings = applyRulings(raw, await listRulings());
  } catch {
    // A ruling store that cannot be read means nothing is suppressed, which
    // errs toward showing too much. Not worth failing the gate over.
  }

  const live = findings.filter((f) => !f.suppressedBy);
  const checks = ALL_CHECKS.filter(
    (c) =>
      (c.scope === "job" || c.scope === "invoice") &&
      settings.checks[c.id as keyof typeof settings.checks]?.enabled,
  ).map((c) => {
    const mine = live.filter((f) => checkIdForKind(f.kind) === c.id);
    return {
      id: c.id,
      title: c.title,
      description: c.description,
      kinds: [...c.kinds],
      errors: mine.filter((f) => f.severity === "error").length,
      warnings: mine.filter((f) => f.severity === "warning").length,
    };
  });
  const invoices = (job?.invoices ?? []).filter((i) => i.status !== "denied");
  const figures: PreSendFigures = {
    invoiceCost: invoices.reduce((s, i) => s + i.cost - depositPart(i).cost, 0),
    toBeInvoiced: job ? job.uninvoicedBillsCost + job.uninvoicedTimeCost + job.draftBillsCost : 0,
    invoiceTotal: invoices.reduce((s, i) => s + i.priceWithTax, 0),
  };
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
    unread: unreadParts(evidence),
    checks,
    figures,
    // Labor counts. A month with no bills but a rate problem on its time
    // entries is exactly the case that must not render as "nothing to check".
    empty:
      !job || (job.bills.length === 0 && job.invoices.length === 0 && job.labor.length === 0),
  };
}
