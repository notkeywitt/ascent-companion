/**
 * The review, end to end: gather the evidence, run the checks, apply the
 * standing rulings, and get a paragraph written over the result.
 *
 * Thin by design — every hard part lives in the module it belongs to, and this
 * file only says what order they happen in. That is the same split the Daily
 * Digest uses (lib/digest/run.ts), and for the same reason: adding a check
 * should never mean editing the runner.
 *
 * Nothing here writes. The only write in the whole feature is `recordRuling`,
 * called from the route when a human overrules a finding.
 */
import { fallbackSummary, runChecks } from "./checks";
import { loadMonthEvidence } from "./evidence";
import { narrateReview } from "./narrate";
import { applyRulings, listRulings } from "./rulings";
import type { ReviewPayload } from "./types";
import type { PaveConfig } from "@/lib/jobtread";

export async function runInvoiceReview(
  cfg: PaveConfig,
  year: number,
  month: number,
  opts: { narrate?: boolean; email?: boolean } = {},
): Promise<ReviewPayload> {
  const started = Date.now();

  const evidence = await loadMonthEvidence(cfg, year, month, { email: opts.email });
  const raw = runChecks(evidence);

  // Rulings are best-effort: a companion DB that is unreachable must not cost
  // the office the review itself. It just means nothing is suppressed, which
  // errs toward showing too much rather than too little.
  let findings = raw;
  try {
    findings = applyRulings(raw, await listRulings());
  } catch (e) {
    evidence.warnings.push(
      `Standing rulings could not be read, so nothing is suppressed — ` +
        `${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  const narrated = opts.narrate === false ? null : await narrateReview(evidence, findings);

  return {
    evidence,
    findings,
    summary: narrated ?? fallbackSummary(evidence, findings),
    summarySource: narrated ? "claude" : "fallback",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}
