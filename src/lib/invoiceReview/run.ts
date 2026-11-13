/**
 * The review, end to end: gather the evidence, run the checks, apply the
 * standing rulings, and file the result.
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
import { loadMonthEvidence } from "./evidence";
import { attachDispositions, readDispositions } from "./dispositions";
import { attachHistory, readFindingState, recordFindings } from "./lifecycle";
import { learnNorms } from "./norms";
import { applyRulings, listRulings } from "./rulings";
import { runChecks } from "./registry";
import { saveRun } from "./runs";
import { fallbackSummary } from "./summary";
import type { ReviewPayload } from "./types";
import { report } from "@/lib/findings";
import type { PaveConfig } from "@/lib/jobtread";

export async function runInvoiceReview(
  cfg: PaveConfig,
  year: number,
  month: number,
  opts: {
    email?: boolean;
    /** Who to file this run under in the history — a signed-in email, or "cron"
     *  for the scheduled run. Omit to run without recording anything. */
    saveAs?: string;
  } = {},
): Promise<ReviewPayload> {
  const started = Date.now();

  const evidence = await loadMonthEvidence(cfg, year, month, { email: opts.email });

  // What the months BEFORE this one looked like. Attached to the evidence so
  // the checks that reason from a pattern stay pure — see norms.ts. Absent
  // history is a perfectly good state; those checks then say nothing.
  const norms = await learnNorms(evidence.ym);
  if (norms) evidence.norms = norms;

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

  // Age each finding against the review's memory. Read BEFORE this run is
  // recorded, or every finding looks like one already seen and nothing is ever
  // new. `attachHistory` no-ops when there is no memory yet.
  const ranAt = new Date().toISOString();
  findings = attachHistory(findings, await readFindingState(evidence.ym), ranAt);

  // Any verdict Claude already reached on these findings (investigate.ts).
  // Carried through so an expensive pass survives a reload — and applied by
  // KEY, so a finding whose evidence moved keeps its verdict only if it is
  // still recognisably the same finding.
  findings = attachDispositions(findings, await readDispositions(evidence.ym));

  // No Claude call here. The paragraph is written from the checks; Claude
  // Code on the office Mac reads the filed run on review days and posts its
  // own reading and per-finding verdicts (/api/invoice-review/agent).
  const payload: ReviewPayload = {
    evidence,
    findings,
    summary: fallbackSummary(evidence, findings),
    summarySource: "fallback",
    summaryNote: "",
    generatedAt: ranAt,
    durationMs: Date.now() - started,
  };

  // History is best-effort by contract: a companion DB that is unreachable must
  // not cost the office a review that otherwise worked. `saveRun` never throws;
  // it hands back the reason, which lands where the office can see it rather
  // than in a log nobody reads.
  if (opts.saveAs) {
    const failed = await saveRun(payload, opts.saveAs);
    if (failed) payload.evidence.warnings.push(`This run could not be filed in the history — ${failed}`);
    // And fold the findings into the month's memory: what is new, what is
    // still here, and what has stopped appearing since last time. The
    // disappearances are the signal every precision figure is built on, so
    // this must happen on every recorded run, not only on the last one.
    const lost = await recordFindings(evidence.ym, payload.findings, ranAt);
    if (lost) {
      payload.evidence.warnings.push(
        `This run's findings could not be added to the review's memory — ${lost}. ` +
          `Ages and check accuracy will be missing a run.`,
      );
    }
    // The same findings into the app's one inbox (lib/findings). A finding
    // under a standing ruling goes in as dismissed, with the ruling's author
    // and reason. A finding with no ruling has its dismissal cleared, so a
    // lifted ruling shows it again.
    try {
      await report(
        "invoice-review",
        payload.findings.map((f) => ({
          key: f.key,
          kind: f.kind,
          subject: f.jobId,
          severity: f.severity,
          title: f.jobName ? `${f.jobName}: ${f.title}` : f.title,
          link: `/invoice-review?ym=${evidence.ym}`,
          dismissed: f.suppressedBy
            ? { by: f.suppressedBy.by, reason: f.suppressedBy.reason, at: f.suppressedBy.at }
            : null,
        })),
        evidence.ym,
        ranAt,
      );
    } catch (e) {
      payload.evidence.warnings.push(
        `This run's findings did not reach Needs attention — ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  }

  return payload;
}
