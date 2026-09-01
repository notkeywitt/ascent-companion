/**
 * CLAUDE AS INVESTIGATOR — the tool loop that chases each finding down.
 *
 * ## What changed, and why it matters
 *
 * `narrate.ts` gives Claude the finished findings and asks for a paragraph. It
 * cannot look anything up, so it can only rephrase what the checks decided.
 * Meanwhile the skill file has always told a HUMAN to go and do the real work:
 * search Drive for the amount, because missing backup is usually a PDF filed
 * under the wrong job; check whether the vendor is spelled differently
 * elsewhere; open both invoices on a suspected double-bill and see if one is a
 * credit. That work only ever happened when somebody had time for it.
 *
 * This module does it. Claude gets read-only tools over the month's evidence
 * (investigateTools.ts) and works the list, ending with a verdict on each
 * finding: is this real, is there a benign explanation, or does it genuinely
 * need a person?
 *
 * ## The boundary, unchanged from narrate.ts
 *
 *   THE CHECKS OWN EVERY NUMBER. CLAUDE OWNS THE JUDGEMENT ABOUT WHICH NUMBERS
 *   MATTER AND WHY. Claude never computes a figure that appears in a finding.
 *
 * And one more that is specific to this pass: **a verdict never suppresses
 * anything.** "probably-fine" leaves the finding on the list at full severity.
 * Only the office can silence a finding, by recording a ruling with a reason
 * against their name. A model's opinion is not allowed to become a decision.
 *
 * ## Why verdicts arrive through a tool
 *
 * Claude calls `record_disposition` once per finding rather than returning one
 * large JSON document at the end. A run that hits its iteration ceiling, or
 * that gets cut off, still yields every verdict it reached before it stopped —
 * and there is no giant blob to fail to parse.
 *
 * Server-only; the API key stays here, the same convention as narrate.ts,
 * learn.ts, digest/claude.ts and gemini.ts.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { PaveConfig } from "@/lib/jobtread";

import {
  buildInvestigateTools,
  findingDigest,
  type DispositionInput,
} from "./investigateTools";
import type { ReviewPayload } from "./types";

/**
 * Sonnet by default. This is the reasoning surface of the feature — it decides
 * what a pile of half-explained discrepancies actually means — but a verdict
 * never suppresses a finding on its own, so a cautious call is bounded, and the
 * feature runs on Sonnet to keep Opus out of every app path.
 * ANTHROPIC_MODEL_INVESTIGATE overrides it without disturbing the summary's own
 * model setting.
 */
const MODEL = process.env.ANTHROPIC_MODEL_INVESTIGATE?.trim() || "claude-sonnet-5";
/** Room for thinking AND for a verdict on every finding. See the ceiling note
 *  in digest/claude.ts — a budget sized for the visible output alone fails by
 *  returning nothing at all. */
const MAX_TOKENS = 32_000;
/** The loop's safety bound. Claude can call several tools per turn, so this is
 *  far more headroom than it sounds. */
const MAX_ITERATIONS = 24;
/** Findings sent in one pass, worst first. A month with more than this has
 *  bigger problems than triage ordering, and the cap keeps one run bounded. */
const MAX_FINDINGS = 60;
const TIMEOUT_MS = 240_000;

let _client: Anthropic | null = null;
function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return (_client ??= new Anthropic({ apiKey: key }));
}

const SYSTEM = [
  "You are investigating a month of CLIENT invoices for Ascent Building Co., a construction",
  "contractor that bills COST-PLUS: clients are billed for vendor cost plus a markup, so there",
  "is no fixed contract ceiling. Missing revenue — cost that never reached an invoice, or a",
  "line billed without its markup — is the failure mode that matters.",
  "",
  "Automated checks have already run and produced findings. THE CHECKS OWN EVERY NUMBER.",
  "You own the judgement about which of those numbers matter, and why. Never compute a new",
  "figure and never contradict a check's arithmetic; if a number looks wrong, say a human",
  "should look, and say what you would check.",
  "",
  "Your job is TRIAGE. For each finding worth judging:",
  "1. Call get_finding_context to see the finding and its job in full.",
  "2. Use the other tools to chase it. In particular:",
  "   - backup-missing: ALWAYS call search_backup_by_amount first. The usual cause is a PDF",
  "     filed under the wrong job, and that is a five-second answer rather than a mystery.",
  "   - email-bill-missed: call find_bills_by_vendor — the bill often exists under a",
  "     different spelling of the vendor's name.",
  "   - scope-duplicate-bill: call get_bill_detail on the bill. A negative cost means a",
  "     credit, which is the usual innocent explanation.",
  "   - markup-rate-drift or vendor-silent: call get_norms and say whether this is unusual",
  "     for THIS customer or vendor, not unusual in general.",
  "3. Call record_disposition with your verdict.",
  "",
  "Verdicts:",
  "- 'confirmed' — you checked and it looks like a real problem. Say what convinced you.",
  "- 'probably-fine' — you found a benign explanation. State the explanation concretely",
  "  ('the PDF is filed under the Okonkwo job'), never as a guess.",
  "- 'needs-human' — it cannot be settled from what you can see. Say what you would need.",
  "  This is the honest answer far more often than the other two, and it is always better",
  "  than a confident verdict you cannot support.",
  "",
  "Rules:",
  "- A verdict NEVER hides a finding. It only says where to start. Do not treat",
  "  'probably-fine' as dismissing something.",
  "- Skip findings already marked as set aside by the office — they have been ruled on.",
  "- Prefer chasing the expensive and the embarrassing first: a charge billed twice, work",
  "  never billed at all, backup that is not on file.",
  "- Do not judge every finding if the list is long. A careful verdict on the ten that",
  "  matter beats a shallow one on forty.",
  "- Write `why` for a busy person who has not read the finding. Plain, concrete, no jargon.",
  "",
  "When you have finished, write two or three sentences telling the office where to start.",
  "No preamble, no markdown headings.",
].join("\n");

export interface InvestigationResult {
  /** Claude's verdicts, in the order it reached them. */
  dispositions: DispositionInput[];
  /** The closing note — where to start. */
  note: string;
  model: string;
  findingsConsidered: number;
  /** True when the loop hit its iteration ceiling before Claude finished. Any
   *  verdicts already reached are still returned. */
  truncated: boolean;
  /** Which tools ran, and how often — so a pass that did no chasing is visible
   *  as such rather than looking like a thorough one. */
  toolCalls: Record<string, number>;
}

/**
 * Investigate a month's live findings.
 *
 * THROWS with a described reason rather than returning an empty result — an
 * empty verdict list and a failed call must never look the same, or the office
 * concludes nothing needed chasing when in fact nothing was asked.
 */
export async function investigateReview(
  payload: ReviewPayload,
  cfg: PaveConfig | null,
): Promise<InvestigationResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  // Findings the office has already ruled on are settled; re-litigating them
  // wastes the pass and risks a model arguing with a human decision.
  const live = payload.findings.filter((f) => !f.suppressedBy);
  if (!live.length) {
    return {
      dispositions: [],
      note: "Nothing to investigate — this month has no open findings.",
      model: MODEL,
      findingsConsidered: 0,
      truncated: false,
      toolCalls: {},
    };
  }

  const dispositions: DispositionInput[] = [];
  const seen = new Set<string>();
  const record = (d: DispositionInput) => {
    // Last verdict wins if Claude revisits a finding after learning more.
    if (seen.has(d.key)) {
      const i = dispositions.findIndex((x) => x.key === d.key);
      if (i >= 0) dispositions[i] = d;
      return;
    }
    seen.add(d.key);
    dispositions.push(d);
  };

  const tools = buildInvestigateTools(payload, cfg, record);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolCalls: Record<string, number> = {};

  const digest = findingDigest(live, MAX_FINDINGS);
  const opening = [
    `Billing month: ${payload.evidence.monthLabel}.`,
    `${live.length} open finding(s)${live.length > MAX_FINDINGS ? `, showing the worst ${MAX_FINDINGS}` : ""}.`,
    payload.evidence.warnings.length
      ? `The evidence is INCOMPLETE: ${payload.evidence.warnings.join(" · ")}. Take that into account — an absence may mean nothing was gathered.`
      : "",
    "",
    JSON.stringify(digest),
  ]
    .filter(Boolean)
    .join("\n");

  const convo: Anthropic.MessageParam[] = [{ role: "user", content: opening }];
  let note = "";
  let truncated = true;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let message: Anthropic.Message;
    try {
      message = await client().messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: "adaptive" },
          system: SYSTEM,
          tools: tools.map(({ name, description, input_schema }) => ({
            name,
            description,
            input_schema,
          })),
          messages: convo,
        },
        { timeout: TIMEOUT_MS },
      );
    } catch (e) {
      // A failure partway through still leaves real verdicts on the table.
      if (dispositions.length) {
        return {
          dispositions,
          note: `The investigation stopped early (${e instanceof Error ? e.message : String(e)}). The verdicts below were reached before it stopped.`,
          model: MODEL,
          findingsConsidered: digest.length,
          truncated: true,
          toolCalls,
        };
      }
      throw new Error(`model "${MODEL}" — ${e instanceof Error ? e.message : String(e)}`);
    }

    if (message.stop_reason === "refusal") throw new Error("Claude declined to investigate");
    convo.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") {
      note = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      truncated = false;
      break;
    }

    const uses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      toolCalls[use.name] = (toolCalls[use.name] ?? 0) + 1;
      let content: string;
      let isError = false;
      try {
        const tool = byName.get(use.name);
        if (!tool) throw new Error(`Unknown tool: ${use.name}`);
        content = JSON.stringify(await tool.handler((use.input ?? {}) as Record<string, unknown>));
      } catch (e) {
        // Fed back to the model rather than thrown: one bad lookup must not
        // abandon the other thirty findings.
        isError = true;
        content = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError });
    }
    convo.push({ role: "user", content: results });
  }

  return {
    dispositions,
    note:
      note ||
      (truncated
        ? "The investigation reached its step limit before finishing. The verdicts below are what it settled."
        : ""),
    model: MODEL,
    findingsConsidered: digest.length,
    truncated,
    toolCalls,
  };
}
