/**
 * Claude chat engine — the server-side tool-use loop behind the /chat assistant.
 *
 * Mirrors src/lib/gemini.ts's "server-only, never import from the browser"
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

import { getPaveConfig } from "@/lib/config";
import { anthropicToolDefs, toolByName } from "@/lib/chatTools";

// Default to the most capable model; ANTHROPIC_MODEL lets the owner pick the
// cheaper/faster claude-sonnet-5 for this high-volume conversational surface.
const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8";
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
  | { type: "error"; error: string };

export interface RunChatOptions {
  messages: Anthropic.MessageParam[];
  jobId?: string;
  onEvent: (event: ChatEvent) => void;
}

/**
 * Drive the tool-use loop to completion, streaming text deltas and tool activity
 * through onEvent. Always emits a terminal `done` event. Per-tool failures are
 * fed back to the model as tool_result errors (never thrown), so one bad lookup
 * doesn't abort the whole answer.
 */
export async function runChat({ messages, jobId, onEvent }: RunChatOptions): Promise<void> {
  const cfg = getPaveConfig();
  const system = buildSystem(jobId);
  const tools = anthropicToolDefs();
  const convo: Anthropic.MessageParam[] = [...messages];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      system,
      tools,
      messages: convo,
    });
    stream.on("text", (delta) => onEvent({ type: "text", text: delta }));

    const message = await stream.finalMessage();
    convo.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") {
      onEvent({ type: "done" });
      return;
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      onEvent({ type: "tool", name: use.name });
      let content: string;
      let isError = false;
      try {
        const tool = toolByName(use.name);
        if (!tool) throw new Error(`Unknown tool: ${use.name}`);
        const out = await tool.handler(cfg, (use.input ?? {}) as Record<string, unknown>);
        content = JSON.stringify(out);
      } catch (e) {
        isError = true;
        content = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      onEvent({ type: "tool_result", name: use.name, ok: !isError });
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content,
        is_error: isError,
      });
    }
    convo.push({ role: "user", content: results });
  }

  onEvent({
    type: "error",
    error: "The assistant hit its tool-call limit before finishing. Try a narrower question.",
  });
  onEvent({ type: "done" });
}
