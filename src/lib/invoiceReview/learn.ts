/**
 * THE LOOP THAT MAKES THE REVIEW GET BETTER — Claude reads the misses and
 * proposes checks that would have caught them.
 *
 * ## What this is for
 *
 * Everything else in this feature can only get quieter. Rulings suppress; norms
 * describe what is usual within things already measured; precision demotes a
 * noisy check. None of them can give the review a sense it does not have.
 *
 * The miss log can, because it records where the review was blind. This module
 * hands that log to Claude together with the checks that already exist, and
 * asks the one question worth asking: *what would have caught these?*
 *
 * ## The human gate is the whole design
 *
 * The answer is a PROPOSAL. It is read, argued with, and implemented by a
 * person; nothing here writes a check, edits settings, or changes what the
 * review reports. That is not caution for its own sake — a check is a claim
 * about how Ascent's money works, and a wrong one either cries wolf every month
 * or, worse, quietly reassures the office about something it got wrong.
 *
 * So the output is deliberately shaped as a SPEC, not as code: what to look at,
 * what makes it wrong, what would make it a false positive, and what evidence
 * the review would have to start gathering. The false-positive field is
 * mandatory in the prompt, because a proposal that hasn't thought about being
 * wrong is the one that shouldn't be built.
 *
 * ## The safety rule this file exists inside
 *
 * Learning may only ADD scrutiny automatically. Removing scrutiny is always a
 * human ruling. Nothing Claude returns here can suppress a finding, disable a
 * check, or move a threshold.
 *
 * Server-only; the API key stays here (same convention as narrate.ts,
 * digest/claude.ts and gemini.ts — each keeps its own client and model var).
 */
import Anthropic from "@anthropic-ai/sdk";

import { ALL_CHECKS } from "./registry";
import type { ReviewMiss } from "./misses";

/**
 * Opus by default, unlike the rest of the feature.
 *
 * narrate.ts summarizes findings that are already decided, which is not a
 * reasoning task. This IS one: it reads a pile of half-written notes about
 * things that went wrong and works out what they have in common and whether a
 * rule could catch it. It runs a handful of times a year, so the frontier model
 * is the obvious call — the expensive thing here would be a bad check, not a
 * bad token.
 */
const MODEL = process.env.ANTHROPIC_MODEL_LEARN?.trim() || "claude-opus-5";
/** Room for thinking AND for several full proposals. See the note in
 *  digest/claude.ts about ceilings that only fit the prose. */
const MAX_TOKENS = 32_000;
const TIMEOUT_MS = 180_000;

let _client: Anthropic | null = null;
function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return (_client ??= new Anthropic({ apiKey: key }));
}

/** One proposed check, as Claude returns it. Prose, for a human to weigh. */
export interface CheckProposal {
  /** Suggested check id, kebab-case, in the style of the existing ones. */
  id: string;
  title: string;
  /** What it would look at, and what makes something wrong. */
  rule: string;
  /** Which recorded misses it would have caught (their ids). */
  wouldHaveCaught: number[];
  /** What would make it fire wrongly. Mandatory — a proposal that hasn't
   *  thought about being wrong is the one not to build. */
  falsePositives: string;
  /** Evidence the review does not currently gather and would need. "" when it
   *  can be built on what is already loaded — those are the cheap ones. */
  newEvidenceNeeded: string;
  /** Claude's own read on whether this is worth building. */
  worthBuilding: string;
}

export interface LearnResult {
  proposals: CheckProposal[];
  /** What Claude made of the log as a whole — patterns, or "not enough yet". */
  note: string;
  model: string;
  missesConsidered: number;
}

const SYSTEM = [
  "You review the CHECK COVERAGE of an automated client-invoice reviewer for Ascent Building Co.,",
  "a cost-plus construction contractor. Ascent bills its clients for vendor cost plus a markup;",
  "there is no fixed-price contract ceiling, so 'over-billing the contract' is not a failure mode",
  "that exists here. Missing REVENUE — cost that never reached a client invoice — is.",
  "",
  "You are given: every check that exists today, and a log of real billing mistakes that got",
  "through anyway, written by the office in their own words.",
  "",
  "Your job is to propose checks that would have caught them. Rules:",
  "- Propose only what the log SUPPORTS. Two vague notes are not a pattern. It is a completely",
  "  good answer to propose nothing and say the log is too thin yet — say so plainly.",
  "- Prefer a check that can be built from evidence the review already gathers (JobTread bills",
  "  and client invoices, the Drive backup PDFs, the office mailbox, and the run history). Say so",
  "  when new evidence would be needed, because that is what makes a check expensive.",
  "- Every proposal must state what would make it FIRE WRONGLY. False positives are the failure",
  "  mode that kills a monthly review — it gets skimmed, then ignored. A check that cannot be",
  "  wrong in any way you can name has not been thought about.",
  "- Do not propose a check that duplicates one that exists. Say if an existing check SHOULD have",
  "  caught it and has a gap — that is a bug report, and more valuable than a new check.",
  "- Never propose anything that writes to JobTread, Drive, the sheet, or an invoice. This",
  "  reviewer is read-only by design and that is not up for negotiation.",
  "",
  "Answer as JSON only, no prose outside it:",
  '{"note": string, "proposals": [{"id": string, "title": string, "rule": string,',
  '"wouldHaveCaught": number[], "falsePositives": string, "newEvidenceNeeded": string,',
  '"worthBuilding": string}]}',
].join("\n");

/**
 * Ask what checks the misses call for.
 *
 * THROWS with a described reason rather than returning empty — an empty
 * proposal list and a failed call must never look the same, or the office
 * concludes there is nothing to learn when really nothing was asked.
 */
export async function proposeChecks(misses: ReviewMiss[]): Promise<LearnResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const open = misses.filter((m) => !m.addressedAt);
  if (!open.length) {
    return {
      proposals: [],
      note: "Nothing on the miss log that hasn't already been addressed. Nothing to learn from yet — record the next billing mistake that gets through and ask again.",
      model: MODEL,
      missesConsidered: 0,
    };
  }

  const payload = {
    existingChecks: ALL_CHECKS.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      scope: c.scope,
      finds: c.kinds,
    })),
    misses: open.map((m) => ({
      id: m.id,
      month: m.ym,
      whatWasWrong: m.description,
      amount: m.amount || undefined,
      job: m.jobName || undefined,
      customer: m.customerName || undefined,
      howItCameToLight: m.howCaught || undefined,
      officeThinksThisCheckShouldHaveCaughtIt: m.shouldHaveBeenCaughtBy || undefined,
    })),
  };

  let res: Anthropic.Message;
  try {
    res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (e) {
    throw new Error(`model "${MODEL}" — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.stop_reason === "refusal") throw new Error("Claude declined to answer");

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error(`Claude returned no text (stop_reason: ${res.stop_reason})`);

  // Tolerate a fenced block around the JSON — cheaper than fighting about it.
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: { note?: unknown; proposals?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Claude's answer wasn't valid JSON");
  }

  const proposals: CheckProposal[] = Array.isArray(parsed.proposals)
    ? (parsed.proposals as Record<string, unknown>[]).map((p) => ({
        id: String(p.id ?? ""),
        title: String(p.title ?? ""),
        rule: String(p.rule ?? ""),
        wouldHaveCaught: Array.isArray(p.wouldHaveCaught)
          ? (p.wouldHaveCaught as unknown[]).map(Number).filter(Number.isFinite)
          : [],
        falsePositives: String(p.falsePositives ?? ""),
        newEvidenceNeeded: String(p.newEvidenceNeeded ?? ""),
        worthBuilding: String(p.worthBuilding ?? ""),
      }))
    : [];

  return {
    proposals,
    note: String(parsed.note ?? ""),
    model: MODEL,
    missesConsidered: open.length,
  };
}
