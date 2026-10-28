import { beforeEach, describe, expect, it, vi } from "vitest";

const { linkSpaceJob, saveTurn } = vi.hoisted(() => ({
  linkSpaceJob: vi.fn(async () => {}),
  saveTurn: vi.fn(async (_t: unknown) => {}),
}));
const { callAppsScriptOrThrow } = vi.hoisted(() => ({
  callAppsScriptOrThrow: vi.fn(async (_b: unknown, _o?: unknown): Promise<unknown> => ({ ok: true })),
}));
vi.mock("@/lib/appsScript", () => ({ callAppsScriptOrThrow }));
vi.mock("@/lib/chatMemory", () => ({ linkSpaceJob, saveTurn, searchJobMemory: vi.fn(async () => []) }));
vi.mock("@/lib/jobtread", async (orig) => ({
  ...(await orig<typeof import("./jobtread")>()),
  getJobs: async () => [
    { id: "a", name: "Smith Kitchen", number: "12", customer: "Jane Smith" },
    { id: "b", name: "Smith Garage", number: "120" },
    { id: "c", name: "Berger Main House", number: "7", customer: "Kevin Berger", address: "1 Spring St" },
  ],
}));

import type { ChatTurn } from "./chatMemory";
import { CHAT_TOOLS, hasAnyWord } from "./chatTools";
import type { JobRef, PaveConfig } from "./jobtread";
import { BOT_TOOLS, botTools, buildHistory, canAsk, jobLine, matchJobs, parseEvent, type BotContext } from "./googleChat";

describe("parseEvent", () => {
  const user = { email: "Ty@AscentBuildingCo.com", displayName: "Ty" };

  it("reads an @mention as a question, without the mention itself", () => {
    expect(
      parseEvent({ type: "MESSAGE", user, message: { text: "@Assistant what's unbilled?", argumentText: " what's unbilled?" } }),
    ).toEqual({ kind: "question", email: "ty@ascentbuildingco.com", name: "Ty", space: "", thread: "", text: "what's unbilled?" });
  });

  it("reads both slash-command shapes", () => {
    const old = parseEvent({ type: "MESSAGE", user, message: { argumentText: "Smith", slashCommand: { commandId: "1" } } });
    const neu = parseEvent({ type: "APP_COMMAND", user, appCommandMetadata: { appCommandId: 3 }, message: { argumentText: "Smith" } });
    expect(old).toMatchObject({ kind: "command", commandId: 1, arg: "Smith" });
    expect(neu).toMatchObject({ kind: "command", commandId: 3, arg: "Smith" });
  });

  it("ignores bots, empty messages and other event types", () => {
    expect(parseEvent({ type: "MESSAGE", user: { type: "BOT" }, message: { text: "hi" } }).kind).toBe("ignore");
    expect(parseEvent({ type: "MESSAGE", user, message: { text: "  " } }).kind).toBe("ignore");
    expect(parseEvent({ type: "REMOVED_FROM_SPACE" }).kind).toBe("ignore");
    expect(parseEvent(null).kind).toBe("ignore");
  });

  it("greets on being added to a space", () => {
    expect(parseEvent({ type: "ADDED_TO_SPACE" }).kind).toBe("added");
  });
});

describe("canAsk", () => {
  it("lets the pilot group ask, in any case, and no one else", () => {
    expect(canAsk("Casey@ascentbuildingco.com")).toBe(true);
    expect(canAsk("sam@ascentbuildingco.com")).toBe(false);
    expect(canAsk("keillor@ascentbuildingco.com.evil.com")).toBe(false);
    expect(canAsk("")).toBe(false);
    expect(canAsk(undefined)).toBe(false);
  });
});

describe("matchJobs", () => {
  const jobs: JobRef[] = [
    { id: "a", name: "Smith Kitchen", number: "12", customer: "Jane Smith" },
    { id: "b", name: "Smith Garage", number: "120" },
    { id: "c", name: "Berger Main House", number: "7", customer: "Kevin Berger" },
  ];

  it("prefers an exact job number", () => {
    expect(matchJobs(jobs, "12").map((j) => j.id)).toEqual(["a"]);
  });

  it("matches every typed word across name and customer", () => {
    expect(matchJobs(jobs, "smith").map((j) => j.id)).toEqual(["a", "b"]);
    expect(matchJobs(jobs, "smith garage").map((j) => j.id)).toEqual(["b"]);
    expect(matchJobs(jobs, "kevin").map((j) => j.id)).toEqual(["c"]);
  });

  it("matches nothing for an empty query", () => {
    expect(matchJobs(jobs, " ")).toEqual([]);
  });

  it("ignores filler words and punctuation", () => {
    const perkins: JobRef = { id: "p", name: "Otis Perkins Addition", number: "004", customer: "Ferron", address: "645 Bayshore Dr" };
    expect(matchJobs([...jobs, perkins], "Ferron Otis Perkins Job").map((j) => j.id)).toEqual(["p"]);
    expect(matchJobs([...jobs, perkins], "the Perkins' job at 645 Bayshore").map((j) => j.id)).toEqual(["p"]);
    expect(matchJobs(jobs, "the job")).toEqual([]);
    expect(matchJobs(jobs, "#7").map((j) => j.id)).toEqual(["c"]);
  });

  it("falls back to the jobs matching most of the words", () => {
    expect(matchJobs(jobs, "smith kitchen remodel").map((j) => j.id)).toEqual(["a"]);
    expect(matchJobs(jobs, "berger deck patio fence").map((j) => j.id)).toEqual([]);
  });
});

describe("parseEvent, add-on app", () => {
  const user = { email: "tommy@ascentbuildingco.com", displayName: "Tommy" };

  it("reads a message, a command and being added", () => {
    expect(parseEvent({ chat: { user, messagePayload: { message: { argumentText: " over budget?" } } } })).toEqual({
      kind: "question",
      email: "tommy@ascentbuildingco.com",
      name: "Tommy",
      space: "",
      thread: "",
      text: "over budget?",
    });
    expect(
      parseEvent({
        chat: { user, appCommandPayload: { appCommandMetadata: { appCommandId: 2 }, message: { argumentText: "" } } },
      }),
    ).toMatchObject({ kind: "command", commandId: 2, arg: "" });
    expect(parseEvent({ chat: { user, addedToSpacePayload: {} } }).kind).toBe("added");
    expect(parseEvent({ chat: { user } }).kind).toBe("ignore");
  });
});

describe("parseEvent, space and thread", () => {
  const user = { email: "ty@ascentbuildingco.com", displayName: "Ty" };
  const message = { argumentText: "tile?", space: { name: "spaces/S1" }, thread: { name: "spaces/S1/threads/T1" } };

  it("reads them from a classic event and an add-on event", () => {
    expect(parseEvent({ type: "MESSAGE", user, message })).toMatchObject({ space: "spaces/S1", thread: "spaces/S1/threads/T1" });
    expect(parseEvent({ chat: { user, messagePayload: { message } } })).toMatchObject({
      space: "spaces/S1",
      thread: "spaces/S1/threads/T1",
    });
  });

  it("falls back to the event's space", () => {
    expect(
      parseEvent({ type: "MESSAGE", user, space: { name: "spaces/S2" }, message: { text: "hi" } }),
    ).toMatchObject({ space: "spaces/S2", thread: "" });
    expect(
      parseEvent({ chat: { user, messagePayload: { space: { name: "spaces/S3" }, message: { text: "hi" } } } }),
    ).toMatchObject({ space: "spaces/S3" });
  });
});

describe("buildHistory", () => {
  const at = "2026-10-03T18:00:00.000Z";
  const t = (kind: ChatTurn["kind"], text: string, author = "Ty"): ChatTurn => ({ kind, author, text, at });

  it("alternates questions and answers, then the new question", () => {
    const h = buildHistory([t("question", "tile?"), t("answer", "Ocean.", "")], { name: "Casey", text: "grout?" });
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(h[0].content).toBe("[Oct 3] Ty asks: tile?");
    expect(h[2].content).toBe("Casey asks: grout?");
  });

  it("merges back-to-back turns of one role and never starts with an answer", () => {
    const h = buildHistory(
      [t("answer", "orphan", ""), t("question", "a?"), t("note", "chose Ocean"), t("answer", "Noted.", "")],
      { name: "Ty", text: "b?" },
    );
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(h[0].content).toBe("[Oct 3] Ty asks: a?\n\n[Oct 3] Ty noted: chose Ocean");
  });

  it("drops the oldest turns past the size cap", () => {
    const h = buildHistory([t("question", "x".repeat(500)), t("answer", "short", "")], { name: "Ty", text: "q" }, 100);
    expect(h).toEqual([{ role: "user", content: "Ty asks: q" }]);
  });
});

describe("jobLine", () => {
  it("names the job, its number, customer and address", () => {
    const job: JobRef = { id: "c", name: "Berger Main House", number: "7", customer: "Kevin Berger", address: "1 Spring St" };
    expect(jobLine(job, { jobId: "c", jobName: "Berger Main House" })).toBe(
      'This space is about the job "Berger Main House" (job_id c; #7, Kevin Berger, 1 Spring St).',
    );
    expect(jobLine(undefined, null)).toBe("This space is not tied to a job yet.");
  });
});

describe("botTools", () => {
  const cfg = {} as PaveConfig;
  let ctx: BotContext;
  const tool = (name: string) => botTools(ctx).find((x) => x.name === name)!;

  beforeEach(() => {
    linkSpaceJob.mockClear();
    saveTurn.mockClear();
    ctx = { cfg, space: "spaces/S1", thread: "", email: "ty@ascentbuildingco.com", name: "Ty", job: null };
  });

  it("links one match and asks about several", async () => {
    expect(await tool("link_space_to_job").handler(cfg, { job: "smith" })).toMatchObject({ linked: false });
    expect(linkSpaceJob).not.toHaveBeenCalled();
    expect(await tool("link_space_to_job").handler(cfg, { job: "berger" })).toMatchObject({ linked: true });
    expect(ctx.job).toEqual({ jobId: "c", jobName: "Berger Main House" });
  });

  it("does not switch a linked space unless asked", async () => {
    ctx.job = { jobId: "a", jobName: "Smith Kitchen" };
    expect(await tool("link_space_to_job").handler(cfg, { job: "berger" })).toMatchObject({ linked: false });
    expect(await tool("link_space_to_job").handler(cfg, { job: "berger", replace: true })).toMatchObject({ linked: true });
  });

  it("saves a note on the space's job, and refuses without one", async () => {
    expect(await tool("save_note").handler(cfg, { text: "chose Ocean" })).toMatchObject({ saved: false });
    ctx.job = { jobId: "c", jobName: "Berger Main House" };
    expect(await tool("save_note").handler(cfg, { text: " chose Ocean " })).toMatchObject({ saved: true });
    expect(saveTurn).toHaveBeenCalledWith(expect.objectContaining({ jobId: "c", kind: "note", author: "Ty", text: "chose Ocean" }));
  });

  it("emails a gap with who asked and the job, and never throws", async () => {
    ctx.job = { jobId: "c", jobName: "Berger Main House" };
    expect(await tool("report_gap").handler(cfg, { question: "gate code?" })).toEqual({ sent: true });
    expect(callAppsScriptOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chatReportGap", question: "gate code?", asker: "Ty", job: "Berger Main House" }),
      expect.anything(),
    );
    callAppsScriptOrThrow.mockRejectedValueOnce(new Error("down"));
    expect(await tool("report_gap").handler(cfg, { question: "gate code?" })).toEqual({ sent: false });
  });
});

describe("BOT_TOOLS", () => {
  it("names only registry tools, and no money tool", () => {
    const names = new Set(CHAT_TOOLS.map((t) => t.name));
    expect(BOT_TOOLS.filter((n) => !names.has(n))).toEqual([]);
    for (const money of ["get_unbilled", "get_coding_queue", "get_bill_detail", "get_job_budget", "get_cost_to_complete"]) {
      expect(BOT_TOOLS).not.toContain(money);
    }
  });
});

describe("hasAnyWord", () => {
  it("matches a stem, any word, and everything when no words", () => {
    expect(hasAnyWord("Plumbing Rough-In", ["plumb"])).toBe(true);
    expect(hasAnyWord("Drywall", ["plumb", "dry"])).toBe(true);
    expect(hasAnyWord("Drywall", ["tile"])).toBe(false);
    expect(hasAnyWord("anything", [])).toBe(true);
  });
});
