/**
 * Claude chat engine — the server-side tool-use loop behind the /chat assistant.
 *
 * Mirrors src/lib/claudeExtract.ts's "server-only, never import from the browser"
 * convention: the API key stays here. The assistant is given the read-only
 * JobTread tools from chatTools.ts and answers questions by calling them; this
 * module runs the agentic loop and streams text + tool activity out via a
 * caller-supplied onEvent callback (the route turns those into an ndjson stream).
 *
 * Grounded in the claude-api skill: official @anthropic-ai/sdk, streaming
 * (messages.stream + finalMessage), a manual tool loop so we can surface which
 * tools fired. Thinking is disabled for a snappy chat — flip to adaptive if a
 * future need calls for deeper reasoning.
 */

import Anthropic from "@anthropic-ai/sdk";
import { trackClaudeUsage } from "@/lib/aiUsage";

import { getPaveConfig } from "@/lib/config";
import { CHAT_TOOLS, anthropicToolDefs, type ChatTool } from "@/lib/chatTools";

// Sonnet by default — fast enough for this high-volume conversational surface
// and keeps Opus out of every app path. ANTHROPIC_MODEL overrides it.
const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 8; // safety bound on the tool loop

let _client: Anthropic | null = null;
function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return (_client ??= new Anthropic({ apiKey: key }));
}

function buildSystem(jobId?: string): string {
  const lines = [
    "You are Ascent Assistant, the internal tool for Ascent Building Co., a construction contractor.",
    "You answer the owner's questions about jobs, budgets, vendor bills, and billing by",
    "calling the provided read-only JobTread tools. JobTread is the single source of truth.",
    "",
    "Guidance:",
    "- When the user names a job in words (e.g. 'the Miller job'), call list_jobs to resolve",
    "  it to a job_id first, then call the job-scoped tool. If several jobs plausibly match,",
    "  ask the user which one rather than guessing.",
    "- search_email reads the office mailbox and search_drive the job folders in Drive. Use",
    "  them when the answer is in a vendor's email or a job document, not in JobTread.",
    "- Money values are US dollars. Amounts owed on a bill include document-level sales tax.",
    "- 'Unbilled' means approved vendor-bill cost not yet on an approved customer invoice.",
    "- You are READ-ONLY: you can look things up but cannot change, code, approve, or create",
    "  anything in JobTread. If asked to make a change, explain that and point them to the",
    "  relevant Assistant screen.",
    "- Be concise and lead with the answer. Show the figures that back it up; don't dump raw",
    "  tool output.",
  ];
  if (jobId) {
    lines.push(
      "",
      `The user currently has a job selected (job_id: ${jobId}). Treat an unqualified`,
      "question ('what's unbilled?', 'show the coding queue') as being about this job unless",
      "they clearly mean another one.",
    );
  }
  return lines.join("\n");
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "done" }
  /** The text so far is withdrawn: a larger model is writing the answer again (`escalate`). */
  | { type: "reset" }
  | { type: "error"; error: string };

export interface RunChatOptions {
  messages: Anthropic.MessageParam[];
  jobId?: string;
  onEvent: (event: ChatEvent) => void;
  /** Overrides ANTHROPIC_MODEL — the Google Chat bot runs on a cheaper model. */
  model?: string;
  /** The `ai_usage` feature name, so each surface's spend reads (and caps) on its own. */
  feature?: string;
  /** Lines appended to the system prompt (e.g. Google Chat's formatting rules). */
  extraSystem?: string;
  /** Only these registry tools, by name. Omitted → every tool in chatTools.ts. */
  tools?: string[];
  /** Tools built for this one request (AscentBot's link and note tools). */
  extraTools?: ChatTool[];
  /**
   * Hand a hard question to a larger model. From round `afterRounds + 1` on,
   * every round runs on `model`. And when a round on the small model ends with
   * an answer `retryIf` rejects (it gave up), that answer is withdrawn (a
   * `reset` event) and the larger model writes it again from the same lookups.
   * One-way: once on the larger model, the loop stays there.
   */
  escalate?: { model: string; afterRounds: number; retryIf?: (text: string) => boolean };
}

/**
 * One round on the larger model. Sonnet 5.5 refuses `thinking: disabled`, so it
 * thinks adaptively at medium effort, and runs through the beta endpoint for
 * the server-side refusal fallback.
 */
type RoundStream = ReturnType<Anthropic["messages"]["stream"]>;

function bigRound(
  model: string,
  system: string,
  tools: ReturnType<typeof anthropicToolDefs>,
  convo: Anthropic.MessageParam[],
): RoundStream {
  // The beta stream emits the same "text" deltas and final message the loop reads.
  return client().beta.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    tools,
    messages: convo,
  } as unknown as Parameters<Anthropic["beta"]["messages"]["stream"]>[0]) as unknown as RoundStream;
}

/**
 * Drive the tool-use loop to completion, streaming text deltas and tool activity
 * through onEvent. Always emits a terminal `done` event. Per-tool failures are
 * fed back to the model as tool_result errors (never thrown), so one bad lookup
 * doesn't abort the whole answer.
 */
export async function runChat({
  messages,
  jobId,
  onEvent,
  model = MODEL,
  feature = "chat",
  extraSystem,
  tools: only,
  extraTools = [],
  escalate,
}: RunChatOptions): Promise<void> {
  const cfg = getPaveConfig();
  const system = extraSystem ? `${buildSystem(jobId)}\n\n${extraSystem}` : buildSystem(jobId);
  const available = [...(only ? CHAT_TOOLS.filter((t) => only.includes(t.name)) : CHAT_TOOLS), ...extraTools];
  const byName = new Map(available.map((t) => [t.name, t]));
  const tools = anthropicToolDefs(available);
  const convo: Anthropic.MessageParam[] = [...messages];

  // One log line per Claude round and per tool, so a slow answer shows where
  // the time went in the Vercel runtime logs.
  const t0 = Date.now();
  const tag = `[chat:${feature}]`;

  let big = false;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const roundStart = Date.now();
    if (escalate && iter >= escalate.afterRounds) big = true;
    const roundModel = big && escalate ? escalate.model : model;
    const stream: RoundStream =
      big && escalate
        ? bigRound(escalate.model, system, tools, convo)
        : client().messages.stream({
            model,
            max_tokens: MAX_TOKENS,
            thinking: { type: "disabled" },
            system,
            tools,
            messages: convo,
          });
    let roundText = "";
    stream.on("text", (delta: string) => {
      roundText += delta;
      onEvent({ type: "text", text: delta });
    });

    const message: Anthropic.Message = await stream.finalMessage();
    console.log(
      `${tag} round ${iter + 1} (${roundModel}): ${Date.now() - roundStart}ms, ${message.usage.input_tokens} in / ` +
        `${message.usage.output_tokens} out, stop=${message.stop_reason}`,
    );
    trackClaudeUsage(feature, roundModel, message.usage, jobId ?? "");

    // The small model gave up: withdraw its answer and let the larger one try from the same lookups.
    if (escalate && !big && message.stop_reason !== "tool_use" && escalate.retryIf?.(roundText)) {
      console.log(`${tag} escalating to ${escalate.model}: the answer gave up`);
      onEvent({ type: "reset" });
      big = true;
      continue;
    }
    convo.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") {
      console.log(`${tag} done in ${Date.now() - t0}ms`);
      onEvent({ type: "done" });
      return;
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    // The tools only read, so a round's lookups run side by side.
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        onEvent({ type: "tool", name: use.name });
        const toolStart = Date.now();
        let content: string;
        let isError = false;
        try {
          const tool = byName.get(use.name);
          if (!tool) throw new Error(`Unknown tool: ${use.name}`);
          const out = await tool.handler(cfg, (use.input ?? {}) as Record<string, unknown>);
          content = JSON.stringify(out);
        } catch (e) {
          isError = true;
          content = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
        console.log(
          `${tag} tool ${use.name} ${JSON.stringify(use.input ?? {})}: ${Date.now() - toolStart}ms, ` +
            `${isError ? `FAILED ${content.slice(0, 200)}` : `${content.length} chars`}`,
        );
        onEvent({ type: "tool_result", name: use.name, ok: !isError });
        return { type: "tool_result", tool_use_id: use.id, content, is_error: isError };
      }),
    );
    convo.push({ role: "user", content: results });
  }

  console.log(`${tag} hit the ${MAX_ITERATIONS}-round limit after ${Date.now() - t0}ms`);
  onEvent({
    type: "error",
    error: "The assistant hit its tool-call limit before finishing. Try a narrower question.",
  });
  onEvent({ type: "done" });
}
