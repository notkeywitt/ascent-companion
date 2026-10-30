import { beforeEach, describe, expect, it, vi } from "vitest";

// Each round hands back the next scripted reply; `calls` records which endpoint and model ran it.
const { script, calls } = vi.hoisted(() => ({
  script: [] as { text: string; stop: string; tool?: string }[],
  calls: [] as { beta: boolean; model: string; thinking: unknown }[],
}));

function fakeStream(beta: boolean) {
  return (params: { model: string; thinking: unknown }) => {
    calls.push({ beta, model: params.model, thinking: params.thinking });
    const step = script.shift()!;
    let onText: (t: string) => void = () => {};
    return {
      on: (_e: string, fn: (t: string) => void) => {
        onText = fn;
      },
      finalMessage: async () => {
        if (step.text) onText(step.text);
        return {
          stop_reason: step.stop,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            ...(step.text ? [{ type: "text", text: step.text }] : []),
            ...(step.tool ? [{ type: "tool_use", id: "t1", name: step.tool, input: {} }] : []),
          ],
        };
      },
    };
  };
}

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: fakeStream(false) };
    beta = { messages: { stream: fakeStream(true) } };
  },
}));
vi.mock("@/lib/aiUsage", () => ({ trackClaudeUsage: vi.fn() }));
vi.mock("@/lib/config", () => ({ getPaveConfig: () => ({}) }));

import { runChat, type ChatEvent } from "./anthropic";

const look = { name: "look", description: "", input_schema: { type: "object" as const, properties: {}, additionalProperties: false as const }, handler: async () => ({ ok: true }) };

async function run(escalate?: Parameters<typeof runChat>[0]["escalate"]) {
  const events: ChatEvent[] = [];
  await runChat({ messages: [{ role: "user", content: "q" }], model: "small", tools: [], extraTools: [look], escalate, onEvent: (e) => events.push(e) });
  return events;
}

beforeEach(() => {
  script.length = 0;
  calls.length = 0;
  process.env.ANTHROPIC_API_KEY = "k";
});

describe("runChat escalate", () => {
  it("stays on the small model for a quick answer", async () => {
    script.push({ text: "", stop: "tool_use", tool: "look" }, { text: "Charcoal Grey.", stop: "end_turn" });
    await run({ model: "big", afterRounds: 2, retryIf: (t) => /couldn't find/.test(t) });
    expect(calls.map((c) => c.model)).toEqual(["small", "small"]);
  });

  it("moves to the larger model after the set rounds, through the beta endpoint with thinking on", async () => {
    script.push(
      { text: "", stop: "tool_use", tool: "look" },
      { text: "", stop: "tool_use", tool: "look" },
      { text: "Done.", stop: "end_turn" },
    );
    await run({ model: "big", afterRounds: 2 });
    expect(calls.map((c) => [c.model, c.beta])).toEqual([["small", false], ["small", false], ["big", true]]);
    expect(calls[2].thinking).toEqual({ type: "adaptive" });
  });

  it("withdraws an answer that gave up and has the larger model write it again", async () => {
    script.push(
      { text: "", stop: "tool_use", tool: "look" },
      { text: "I couldn't find the roof color.", stop: "end_turn" },
      { text: "Charcoal Grey, per bill #407.", stop: "end_turn" },
    );
    const events = await run({ model: "big", afterRounds: 2, retryIf: (t) => /couldn't find/.test(t) });
    expect(calls.map((c) => c.model)).toEqual(["small", "small", "big"]);
    const text = events.reduce((t, e) => (e.type === "reset" ? "" : e.type === "text" ? t + e.text : t), "");
    expect(text).toBe("Charcoal Grey, per bill #407.");
  });

  it("never escalates without the option", async () => {
    script.push({ text: "", stop: "tool_use", tool: "look" }, { text: "", stop: "tool_use", tool: "look" }, { text: "x", stop: "end_turn" });
    await run();
    expect(calls.every((c) => c.model === "small" && !c.beta)).toBe(true);
  });

  it("retries an answer given with no lookup at all, and tells the larger model so", async () => {
    script.push(
      { text: "I can't share that.", stop: "end_turn" },
      { text: "", stop: "tool_use", tool: "look" },
      { text: "Ty's birthday is March 4.", stop: "end_turn" },
    );
    const seen: boolean[] = [];
    const events = await run({
      model: "big",
      afterRounds: 2,
      retryIf: (_t, usedTools) => (seen.push(usedTools), !usedTools),
      hint: "Look it up first.",
    });
    expect(seen).toEqual([false]);
    expect(calls.map((c) => c.model)).toEqual(["small", "big", "big"]);
    const text = events.reduce((t, e) => (e.type === "reset" ? "" : e.type === "text" ? t + e.text : t), "");
    expect(text).toBe("Ty's birthday is March 4.");
  });

  it("does not retry an answer that came after a lookup", async () => {
    script.push({ text: "", stop: "tool_use", tool: "look" }, { text: "Done.", stop: "end_turn" });
    await run({ model: "big", afterRounds: 2, retryIf: (_t, usedTools) => !usedTools });
    expect(calls.map((c) => c.model)).toEqual(["small", "small"]);
  });
});
