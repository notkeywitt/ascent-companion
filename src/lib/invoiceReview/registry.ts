/**
 * THE CHECK REGISTRY — the one list of checks the review runs, and the runner.
 *
 * ── ADDING A CHECK ──────────────────────────────────────────────────────────
 *   1. Write `checks/myCheck.ts` exporting a `defineJobCheck({...})` (or
 *      `defineInvoiceCheck` / `defineMonthCheck`, per the unit it reasons about).
 *   2. Add its config block to `settings.ts` under the same id.
 *   3. Add it to the array below for its scope.
 * That's the whole job. The runner, the route, the history and the page are all
 * driven by these lists — none of them needs to know a new check exists.
 *
 * ── WHY `enabled` AND `config` COME FROM SETTINGS ───────────────────────────
 * A check file declares BEHAVIOR; `settings.ts` declares POLICY. Keeping them
 * apart is what puts every threshold in one editable file instead of scattered
 * as constants through eight check bodies. A check whose id has no settings
 * block is treated as disabled and says so loudly — that's the typo case, and
 * silently not running a check is the worst possible failure for a system whose
 * whole job is noticing things.
 *
 * ── WHY THE SCOPES ARE THREE SEPARATE ARRAYS ────────────────────────────────
 * Because they are genuinely three different loops, and writing them as one
 * list with a discriminator would mean the runner casting its way back to the
 * distinction on every iteration. See checkTypes.ts for what each scope means.
 */
import type { InvoiceCheck, JobCheck, MonthCheck } from "./checkTypes";
import { DEFAULT_SETTINGS, type CheckId, type InvoiceReviewSettings } from "./settings";
import { compareFindings, type Finding, type MonthEvidence } from "./types";

import { backupCheck } from "./checks/backup";
import { costBasisCheck } from "./checks/costBasis";
import { draftBillsCheck } from "./checks/draftBills";
import { duplicateBillCheck } from "./checks/duplicateBill";
import { invoiceMathCheck } from "./checks/invoiceMath";
import { issueDateCheck } from "./checks/issueDate";
import { mailCaptureCheck } from "./checks/mailCapture";
import { uninvoicedCheck } from "./checks/uninvoiced";

/** Once per job. */
const JOB_CHECKS: JobCheck<never>[] = [
  backupCheck,
  duplicateBillCheck,
  uninvoicedCheck,
  draftBillsCheck,
] as unknown as JobCheck<never>[];

/** Once per client invoice. */
const INVOICE_CHECKS: InvoiceCheck<never>[] = [
  invoiceMathCheck,
  issueDateCheck,
  costBasisCheck,
] as unknown as InvoiceCheck<never>[];

/** Once per review. */
const MONTH_CHECKS: MonthCheck<never>[] = [mailCaptureCheck] as unknown as MonthCheck<never>[];

/** Every declared check, whatever its scope — for listing and validation. */
export const ALL_CHECKS = [...JOB_CHECKS, ...INVOICE_CHECKS, ...MONTH_CHECKS];

/**
 * Two things that must be true of the registry, asserted once at module load
 * rather than trusted.
 *
 * A duplicate ID would make two checks share one settings block. A duplicate
 * KIND is worse: a kind is half of a finding's suppression identity, so two
 * checks emitting one would make a single ruling silence findings the office
 * never saw. Both are the kind of mistake that is invisible in review and
 * obvious in a stack trace, so it is raised here.
 */
function assertRegistryIsSane(): void {
  const seenIds = new Set<string>();
  const seenKinds = new Map<string, string>();
  for (const c of ALL_CHECKS) {
    if (seenIds.has(c.id)) throw new Error(`Two invoice-review checks share the id "${c.id}".`);
    seenIds.add(c.id);
    for (const k of c.kinds) {
      const owner = seenKinds.get(k);
      if (owner) {
        throw new Error(
          `Finding kind "${k}" is emitted by both "${owner}" and "${c.id}". A kind is half ` +
            `of a finding's suppression identity — two owners would make one ruling silence ` +
            `findings the office never saw.`,
        );
      }
      seenKinds.set(k, c.id);
    }
  }
}
assertRegistryIsSane();

/** A check's settings block, or null when it has none (treated as disabled). */
function blockFor(id: string, settings: InvoiceReviewSettings) {
  const block = settings.checks[id as CheckId] as
    | { enabled: boolean; config: unknown }
    | undefined;
  if (!block) {
    // Loud, because the alternative is a check that silently never runs.
    console.error(
      `[invoice-review] check "${id}" has no block in settings.ts, so it will not run.`,
    );
    return null;
  }
  return block;
}

/**
 * Every finding in a month, worst first.
 *
 * Suppression is NOT applied here — that is `applyRulings` in rulings.ts, kept
 * separate so the raw findings stay inspectable and a ruling can be lifted
 * without re-running the checks.
 *
 * A check that throws does not take the review down with it. The whole point of
 * a monthly review is that it runs; losing one check's findings is bad, losing
 * all of them because one job had an odd shape is much worse. The failure is
 * recorded on `month.warnings`, which the page renders as "this review is
 * incomplete" — so a check that silently stopped working can never read as a
 * check that found nothing.
 */
export function runChecks(
  month: MonthEvidence,
  settings: InvoiceReviewSettings = DEFAULT_SETTINGS,
): Finding[] {
  const out: Finding[] = [];
  const global = settings.global;

  const guard = (id: string, subject: string, fn: () => Finding[]) => {
    try {
      out.push(...fn());
    } catch (e) {
      month.warnings.push(
        `The "${id}" check failed on ${subject} — ${
          e instanceof Error ? e.message : "unknown error"
        }. Anything it would have found is missing from this review.`,
      );
    }
  };

  for (const job of month.jobs) {
    for (const check of JOB_CHECKS) {
      const block = blockFor(check.id, settings);
      if (!block?.enabled) continue;
      guard(check.id, job.jobName || job.customerName || job.jobId, () =>
        check.run({ config: block.config as never, global, month, job }),
      );
    }
    for (const invoice of job.invoices) {
      for (const check of INVOICE_CHECKS) {
        const block = blockFor(check.id, settings);
        if (!block?.enabled) continue;
        guard(check.id, `invoice #${invoice.number || invoice.id}`, () =>
          check.run({ config: block.config as never, global, month, job, invoice }),
        );
      }
    }
  }

  for (const check of MONTH_CHECKS) {
    const block = blockFor(check.id, settings);
    if (!block?.enabled) continue;
    guard(check.id, month.monthLabel, () =>
      check.run({ config: block.config as never, global, month }),
    );
  }

  return out.sort(compareFindings);
}
