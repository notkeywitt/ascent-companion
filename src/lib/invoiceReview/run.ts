/**
 * The review, end to end: gather the evidence, run the checks, apply the
 * standing rulings, and get a paragraph written over the result.
 *
 * Thin by design — every hard part lives in the module it belongs to, and this
 * file only says what order they happen in. That is the same split the Daily
 * Digest uses (lib/digest/run.ts), and for the same reason: adding a check
 * should never mean editing the runner.
 *
 * Nothing here touches JobTread, Drive or Gmail. It writes exactly two things,
 * both to the companion's own database: the run itself (history — see runs.ts),
 * and, from the route rather than here, a ruling when a human overrules a
 * finding. A reviewer still cannot change anything it reviews.
 */
import { fallbackSummary, runChecks } from "./checks";
import { loadMonthEvidence } from "./evidence";
import { narrateReview } from "./narrate";
import { applyRulings, listRulings } from "./rulings";
import { saveRun } from "./runs";
import type { ReviewPayload } from "./types";
import type { PaveConfig } from "@/lib/jobtread";

export async function runInvoiceReview(
  cfg: PaveConfig,
  year: number,
  month: number,
  opts: {
    narrate?: boolean;
    email?: boolean;
    /** Who to file this run under in the history — a signed-in email, or "cron"
     *  for the scheduled run. Omit to run without recording anything. */
    saveAs?: string;
  } = {},
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

  // Claude writes the opening paragraph; the checks own every number in it.
  // A failure here is never allowed to cost the office the review, but it is no
  // longer allowed to be invisible either — the reason is carried on the
  // payload and drawn on the page. See narrate.ts.
  let narrated = "";
  let summaryNote = "";
  if (opts.narrate === false) {
    summaryNote = "The summary was skipped for this run.";
  } else {
    try {
      narrated = await narrateReview(evidence, findings);
    } catch (e) {
      summaryNote = `Claude didn't write the summary (${
        e instanceof Error ? e.message : "unknown error"
      }) — this is the built-in one.`;
    }
  }

  const payload: ReviewPayload = {
    evidence,
    findings,
    summary: narrated || fallbackSummary(evidence, findings),
    summarySource: narrated ? "claude" : "fallback",
    summaryNote,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };

  // History is best-effort by contract: a companion DB that is unreachable must
  // not cost the office a review that otherwise worked. `saveRun` never throws;
  // it hands back the reason, which lands where the office can see it rather
  // than in a log nobody reads.
  if (opts.saveAs) {
    const failed = await saveRun(payload, opts.saveAs);
    if (failed) payload.evidence.warnings.push(`This run could not be filed in the history — ${failed}`);
  }

  return payload;
}
