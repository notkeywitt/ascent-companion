/**
 * Claude's read of the month — the paragraph at the top of the review.
 *
 * Server-only; the API key stays here (same convention as src/lib/anthropic.ts
 * and src/lib/gemini.ts). Uses the plain Messages API, not the chat engine's
 * tool loop: there is nothing to look up, because everything Claude is allowed
 * to say is already in the findings.
 *
 * ## What Claude is and isn't for here
 *
 * The CHECKS decide what is wrong. They are deterministic, unit-tested, and
 * they own every number. Claude's job is triage and prose: which of nineteen
 * findings the office should open first, and why, in two or three sentences a
 * busy person reads on a phone. It is handed the STRUCTURED findings only —
 * never the raw evidence, never a PDF, never a JobTread document — so it cannot
 * invent a figure that no check verified.
 *
 * Failure always falls back to the locally-built summary (`fallbackSummary` in
 * summary.ts). A review that lists real problems in dull language is completely
 * fine; a review that doesn't render because an API key expired is not.
 *
 * But it is NOT silent. This function THROWS with a described reason rather
 * than returning a bare null, and the caller (`runInvoiceReview`) stamps that
 * reason onto the payload as `summaryNote`. The silent version hid a real
 * outage for as long as it lasted: a missing key, an expired key, a bad model
 * id and a timeout were all indistinguishable from "Claude wrote nothing much".
 * Same fix, same reasoning as src/lib/digest/claude.ts.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { Finding, MonthEvidence } from "./types";

/** Sonnet by default: this is one short paragraph over pre-computed findings,
 *  which is not work that needs the frontier model. ANTHROPIC_MODEL_REVIEW
 *  overrides it without disturbing the /chat assistant's own model setting. */
const MODEL = process.env.ANTHROPIC_MODEL_REVIEW?.trim() || "claude-sonnet-5";
/**
 * ⚠️ THIS CEILING MUST LEAVE ROOM FOR THINKING, NOT JUST FOR THE ANSWER.
 *
 * On Sonnet 5 (and the rest of the current family) OMITTING the `thinking`
 * parameter runs ADAPTIVE THINKING — it is on by default, not off — and thinking
 * tokens are drawn from `max_tokens` before a single text block is emitted.
 * `display` also defaults to "omitted", so those blocks come back empty. A
 * ceiling sized for the prose alone therefore fails in the worst possible way:
 * the whole budget goes to thinking, the response carries NO text block at all,
 * and `stop_reason` is "max_tokens".
 *
 * This was 600 — BELOW the 900 that took out the digest summary on 2026-08-31
 * (see the same note in src/lib/digest/claude.ts), on a path whose fallback was
 * silent, so nothing ever said it was happening. A ceiling is not a spend: you
 * are billed for tokens actually generated, so the headroom is free. Do not
 * "optimize" this back down to the size of the expected paragraph.
 */
const MAX_TOKENS = 16_000;
/** The review route has its own budget; don't let one slow call eat it. */
const TIMEOUT_MS = 30_000;

let _client: Anthropic | null = null;
function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return (_client ??= new Anthropic({ apiKey: key }));
}

const SYSTEM = [
  "You are reviewing a month of CLIENT invoices for Ascent Building Co., a construction",
  "contractor, and writing the opening paragraph the office reads before they open anything.",
  "",
  "You are given the OUTPUT of automated checks that have already run — not the invoices",
  "themselves. Those checks own every number.",
  "",
  "Rules:",
  "- Write 2-4 plain sentences, about 80 words. No markdown, no bullets, no headings,",
  "  no greeting, no sign-off.",
  "- Lead with the single thing most likely to cost money or embarrass the company with a",
  "  client: a charge billed twice, work done and never billed, backup that isn't on file.",
  "- Use only figures that appear in the data. Never compute a new total, never estimate,",
  "  never say 'roughly'. If you want to name a number, copy it.",
  "- Name the customer or job when it makes the sentence concrete.",
  "- Findings marked suppressed have already been ruled on by the office. Do not raise them",
  "  again; you may note in passing how many were set aside.",
  "- If nothing is flagged, say so in one sentence and stop.",
  "- If the data lists warnings about evidence that could not be gathered, say the review is",
  "  incomplete and why, because a partial review must never read as a clean one.",
  "- A finding marked new is one no earlier run saw; one marked standing has been there a while.",
  "  Lead with what is new when it matters, and it is worth saying when something has been",
  "  sitting unfixed for months.",
].join("\n");

/**
 * The owner's standing instructions, as a block appended to the system prompt.
 *
 * These shape HOW the month is read out — never what was found. Nothing here
 * can hide a finding, and the rule above it says so in the prompt itself,
 * because these are the owner's words going into a model and the model should
 * not treat "don't mention Shop" as licence to drop a real problem.
 */
function instructionBlock(instructions: string[]): string {
  if (!instructions.length) return "";
  return [
    "",
    "STANDING INSTRUCTIONS from the owner about how they want the month read to them.",
    "Follow them when writing the paragraph. They change the EMPHASIS and the ORDER only:",
    "they can never make you leave out a finding, soften a figure, or call an incomplete",
    "review a clean one. If one seems to ask for that, follow the rules above instead.",
    ...instructions.map((t) => `- ${t}`),
  ].join("\n");
}

/**
 * A paragraph over the month's findings.
 *
 * THROWS with a described reason when it cannot answer — it does not return a
 * bare null. The caller catches, records the reason, and falls back to
 * `fallbackSummary`.
 */
export async function narrateReview(
  month: MonthEvidence,
  findings: Finding[],
  /** The owner's standing instructions (instructions.ts). Read by the caller,
   *  not here, so this file stays free of database imports. */
  instructions: string[] = [],
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  // Only the shape Claude is allowed to reason about. Deliberately excludes the
  // evidence bundle: no line items, no file lists, no invoice headers — so there
  // is nothing to hallucinate a total out of.
  const payload = {
    month: month.monthLabel,
    jobs: month.jobs.length,
    invoices: month.jobs.reduce((s, j) => s + j.invoices.length, 0),
    evidenceWarnings: month.warnings,
    findings: findings.map((f) => ({
      severity: f.severity,
      kind: f.kind,
      customer: f.customerName,
      job: f.jobName,
      invoice: f.invoiceNumber || undefined,
      title: f.title,
      detail: f.detail,
      amount: f.amount,
      suppressed: Boolean(f.suppressedBy),
      // So Claude can lead with what is actually new. Only ever a label —
      // every figure still comes from the checks.
      age: f.history
        ? f.history.isNew
          ? "new"
          : `seen on ${f.history.runsSeen} checks since ${f.history.firstSeenAt.slice(0, 10)}`
        : undefined,
    })),
  };

  let res: Anthropic.Message;
  try {
    res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Low effort: this ranks findings the checks have already decided, in
        // about 80 words. It is not a reasoning task, and since thinking is on
        // by default (see the max_tokens note above) capping its DEPTH is what
        // keeps the call quick — the token ceiling only stops it failing.
        output_config: { effort: "low" },
        system: SYSTEM + instructionBlock(instructions),
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (e) {
    // The model id rides along because a bad ANTHROPIC_MODEL_REVIEW is one of
    // the likeliest causes and is otherwise invisible from the review screen.
    throw new Error(`model "${MODEL}" — ${e instanceof Error ? e.message : String(e)}`);
  }

  if (res.stop_reason === "refusal") throw new Error("Claude declined to write the summary");
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  // The empty-text case the ceiling above exists to prevent. Naming stop_reason
  // makes a recurrence diagnosable from the screen instead of from a log.
  if (!text) throw new Error(`Claude returned no text (stop_reason: ${res.stop_reason})`);
  return text;
}
