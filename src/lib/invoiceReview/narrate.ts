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
 * Failure is always silent and always falls back to the locally-built summary
 * (`fallbackSummary` in checks.ts). A review that lists real problems in dull
 * language is completely fine; a review that doesn't render because an API key
 * expired is not.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { Finding, MonthEvidence } from "./types";

/** Sonnet by default: this is one short paragraph over pre-computed findings,
 *  which is not work that needs the frontier model. ANTHROPIC_MODEL_REVIEW
 *  overrides it without disturbing the /chat assistant's own model setting. */
const MODEL = process.env.ANTHROPIC_MODEL_REVIEW?.trim() || "claude-sonnet-5";
const MAX_TOKENS = 600;
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
].join("\n");

/**
 * A paragraph over the month's findings, or null if Claude isn't configured or
 * didn't answer. The caller falls back to `fallbackSummary`.
 */
export async function narrateReview(
  month: MonthEvidence,
  findings: Finding[],
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;

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
    })),
  };

  try {
    const res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      },
      { timeout: TIMEOUT_MS },
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    // Silent by design — see the module note.
    return null;
  }
}
