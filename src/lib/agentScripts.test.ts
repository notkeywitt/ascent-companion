import { describe, expect, it } from "vitest";

import { AGENT_SCRIPTS, cleanRunArg, cleanSettings, scriptById } from "./agentScripts";

describe("the script list", () => {
  it("has unique ids, and every script has a folder and a skill", () => {
    const ids = AGENT_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of AGENT_SCRIPTS) {
      expect(s.folder).toBe(`scripts/${s.id}/`);
      expect(s.skill).toBe(`/${s.id}`);
    }
  });
  it("runs lead research on Sonnet by default", () => {
    expect(scriptById("lead-research")?.defaultModel).toBe("sonnet");
  });
});

describe("cleanSettings", () => {
  it("keeps only known settings, and checks each", () => {
    expect(cleanSettings({ model: "haiku", paused: true, maxTurns: 40, extraPrompt: "  x  ", action: "settings" })).toEqual({
      ok: { model: "haiku", paused: true, maxTurns: 40, extraPrompt: "x" },
    });
    expect(cleanSettings({ model: "gpt" })).toHaveProperty("error");
    expect(cleanSettings({ maxTurns: -1 })).toHaveProperty("error");
    expect(cleanSettings({ maxTurns: 2.5 })).toHaveProperty("error");
    expect(cleanSettings({ extraPrompt: "x".repeat(5000) })).toHaveProperty("error");
  });
});

describe("cleanRunArg", () => {
  const monthly = scriptById("monthly-check")!;
  const tools = scriptById("tool-batch")!;
  it("accepts a billing month, or nothing", () => {
    expect(cleanRunArg(monthly, "2026-10")).toEqual({ ok: "2026-10" });
    expect(cleanRunArg(monthly, "")).toEqual({ ok: "" });
    expect(cleanRunArg(monthly, "2026-13")).toHaveProperty("error");
    expect(cleanRunArg(monthly, "2026-10; rm -rf /")).toHaveProperty("error");
  });
  it("refuses a value for a script that takes none", () => {
    expect(cleanRunArg(tools, "x")).toHaveProperty("error");
  });
});
