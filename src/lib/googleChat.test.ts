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
  getOpenToDos: async () => [
    { id: "1", name: "Order windows", endDate: "2000-01-01", jobName: "Smith Kitchen", assignees: ["Ty"], assigneeIds: [] },
    { id: "2", name: "Call inspector", endDate: "2999-01-01", jobName: null, assignees: [], assigneeIds: [] },
    { id: "3", name: "Pick tile", jobName: "Berger Main House", assignees: ["Casey"], assigneeIds: [] },
  ],
  getJobs: async () => [
    { id: "a", name: "Smith Kitchen", number: "12", customer: "Jane Smith" },
    { id: "b", name: "Smith Garage", number: "120" },
    { id: "c", name: "Berger Main House", number: "7", customer: "Kevin Berger", address: "1 Spring St" },
  ],
}));

import type { ChatTurn } from "./chatMemory";
import { CHAT_TOOLS, groupScopeLines, hasAnyWord, summarizeJobTime } from "./chatTools";
import type { JobRef, PaveConfig } from "./jobtread";
import {
  answerCollector,
  BOT_TOOLS,
  botTools,
  buildHistory,
  canAsk,
  jobLine,
  looksUnanswered,
  matchJobs,
  parseEvent,
  summarizeMileage,
  todayLine,
  type BotContext,
} from "./googleChat";

describe("parseEvent", () => {
  const user = { email: "Ty@AscentBuildingCo.com", displayName: "Ty" };

  it("reads an @mention as a question, without the mention itself", () => {
    expect(
      parseEvent({ type: "MESSAGE", user, message: { text: "@Assistant what's unbilled?", argumentText: " what's unbilled?" } }),
    ).toEqual({ kind: "question", email: "ty@ascentbuildingco.com", name: "Ty", user: "", space: "", thread: "", text: "what's unbilled?" });
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
  const user = { name: "users/42", email: "tommy@ascentbuildingco.com", displayName: "Tommy" };

  it("reads a message, a command and being added", () => {
    expect(parseEvent({ chat: { user, messagePayload: { message: { argumentText: " over budget?" } } } })).toEqual({
      kind: "question",
      email: "tommy@ascentbuildingco.com",
      name: "Tommy",
      user: "users/42",
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
    expect(ctx.gapReported).toBe(true);
    callAppsScriptOrThrow.mockClear();
    expect(await tool("report_gap").handler(cfg, { question: "gate code?" })).toEqual({ sent: true });
    expect(callAppsScriptOrThrow).not.toHaveBeenCalled(); // once per question
    ctx.gapReported = false;
    callAppsScriptOrThrow.mockRejectedValueOnce(new Error("down"));
    expect(await tool("report_gap").handler(cfg, { question: "gate code?" })).toEqual({ sent: false });
  });
});

describe("looksUnanswered", () => {
  it("spots an answer that found nothing", () => {
    expect(looksUnanswered("I couldn’t find the roof color in the selections or documents.")).toBe(true);
    expect(looksUnanswered("I could not find that.")).toBe(true);
    expect(looksUnanswered("There's no record of the gate code.")).toBe(true);
    expect(looksUnanswered("The roof color isn't recorded anywhere I can see.")).toBe(true);
  });

  it("leaves a real answer alone", () => {
    expect(looksUnanswered("*Charcoal Grey*, inferred from bills (Sunset bill #407, Sep 25).")).toBe(false);
    expect(looksUnanswered("Noted for Otis Perkins Addition.")).toBe(false);
    expect(looksUnanswered("The Ascent app has the budget.")).toBe(false);
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

describe("todayLine", () => {
  it("names the Pacific day, not the UTC one", () => {
    // 03:00 UTC on Oct 29 is still the evening of Oct 28 in Pacific.
    expect(todayLine(new Date("2026-10-29T03:00:00Z"))).toBe("Today is Wednesday, Oct 28, 2026 (2026-10-28), Pacific time.");
  });
});

describe("summarizeJobTime", () => {
  const line = (person: string, start: string, minutes: number, costCode: string, end = "x") => ({
    person,
    start,
    end,
    minutes,
    costCode,
    costItem: "",
    notes: "",
  });

  it("totals hours by person and code, and lists who is clocked in", () => {
    const s = summarizeJobTime({
      lines: [
        line("Cedar", "2026-10-28T07:00:00", 0, "06 20 13 Exterior Finish Carpentry", ""),
        line("Cedar", "2026-10-27T07:00:00", 240, "06 20 13 Exterior Finish Carpentry"),
        line("Rachel", "2026-10-20T07:00:00", 90, "07 46 23 Wood Siding"),
        line("Cedar", "2026-10-20T12:00:00", 60, "07 46 23 Wood Siding"),
      ],
      count: 4,
      minutes: 390,
      more: false,
    });
    expect(s.totalHours).toBe(6.5);
    expect(s.clockedInNow).toEqual([expect.objectContaining({ person: "Cedar", since: "2026-10-28T07:00:00" })]);
    expect(s.byPerson[0]).toEqual({ person: "Cedar", hours: 5, days: 3, first: "2026-10-20", last: "2026-10-28" });
    expect(s.byCostCode.map((c) => [c.costCode, c.hours])).toEqual([
      ["06 20 13 Exterior Finish Carpentry", 4],
      ["07 46 23 Wood Siding", 2.5],
    ]);
    expect(s.newest[0].end).toBe("still clocked in");
    expect(JSON.stringify(s)).not.toMatch(/cost"|rate|pay/i);
  });

  it("says when the breakdown covers only the newest entries", () => {
    const s = summarizeJobTime({ lines: [line("Ty", "2026-10-01T08:00:00", 60, "")], count: 1500, minutes: 90000, more: true });
    expect(s.totalHours).toBe(1500);
    expect(s.note).toMatch(/all 1500 entries/);
  });
});

describe("groupScopeLines", () => {
  const line = (name: string, isSelected: boolean | null, number = "204") => ({
    document: "Selection",
    documentNumber: number,
    status: "approved",
    issueDate: "2026-07-06",
    name,
    description: "",
    costCode: "07 62 00 Living Roof System",
    group: "Selections",
    groupNote: "From Bill Ferron: yes to rocks",
    isSelected,
  });

  it("groups by document, keeps the note once, and marks the chosen option", () => {
    const out = groupScopeLines([line("YES ROCKS", true), line("NO ROCKS", false), line("Deck scope", null, "116")]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ document: "Selection #204", status: "approved", date: "2026-07-06" });
    expect(out[0].groups).toEqual([
      {
        group: "Selections",
        note: "From Bill Ferron: yes to rocks",
        lines: [
          { name: "YES ROCKS", costCode: "07 62 00 Living Roof System", option: "chosen" },
          { name: "NO ROCKS", costCode: "07 62 00 Living Roof System", option: "not chosen" },
        ],
      },
    ]);
    expect(out[1].groups[0].lines[0]).not.toHaveProperty("option");
  });
});

describe("answerCollector", () => {
  it("drops a draft written before a lookup, keeps text before the bot's own actions", () => {
    const a = answerCollector();
    a.onEvent({ type: "text", text: "Nothing records it. I'll check Drive too." });
    a.onEvent({ type: "tool", name: "search_drive" });
    a.onEvent({ type: "text", text: "Nothing I checked records the siding color." });
    a.onEvent({ type: "tool", name: "report_gap" });
    a.onEvent({ type: "text", text: " I've let the office know." });
    expect(a.text()).toBe("Nothing I checked records the siding color. I've let the office know.");
  });

  it("clears on a reset", () => {
    const a = answerCollector();
    a.onEvent({ type: "text", text: "I couldn't find it." });
    a.onEvent({ type: "reset" });
    a.onEvent({ type: "text", text: "Charcoal Grey." });
    expect(a.text()).toBe("Charcoal Grey.");
  });
});

describe("find_tools and get_todos", () => {
  const cfg = {} as PaveConfig;
  const tool = (name: string) => CHAT_TOOLS.find((t) => t.name === name)!;

  it("finds a tool by name or by the job it sits at", async () => {
    callAppsScriptOrThrow.mockResolvedValueOnce({
      ok: true,
      tools: [
        { name: "Track saw", type: "Saw", locationLabel: "Keeler - Remodel", lastscan: "10/20/2026", lastScanEmail: "ty@x" },
        { name: "Laser level", type: "Layout", locationLabel: "" },
      ],
    });
    const r = (await tool("find_tools").handler(cfg, { words: "keeler" })) as { count: number; tools: unknown[] };
    expect(r.count).toBe(1);
    expect(r.tools[0]).toMatchObject({ name: "Track saw", location: "Keeler - Remodel", by: "ty@x" });
  });

  it("lists open to-dos overdue first, and names unassigned ones", async () => {
    const r = (await tool("get_todos").handler(cfg, {})) as { overdue: number; todos: { name: string; assignedTo: string; job: string }[] };
    expect(r.overdue).toBe(1);
    expect(r.todos.map((t) => t.name)).toEqual(["Order windows", "Call inspector", "Pick tile"]);
    expect(r.todos[1]).toMatchObject({ assignedTo: "nobody", job: "(no job)" });
  });
});

describe("get_mileage", () => {
  it("asks as the person asking, and totals miles by driver and job", async () => {
    const ctx = { cfg: {} as PaveConfig, space: "spaces/S1", thread: "", email: "ty@ascentbuildingco.com", name: "Ty", job: null };
    callAppsScriptOrThrow.mockResolvedValueOnce({
      ok: true,
      trips: [
        { Date: "2026-10-02", Driver: "Ty O'Steen", Job: "Keeler - Remodel", Miles: "12.5", Polyline: "abc", "Start Lat": "48" },
        { Date: "2026-10-01", Driver: "Seth", Job: "Keeler - Remodel", Miles: "10" },
        { Date: "2026-10-01", Driver: "Seth", Job: "Berger - Bunkhouse", Miles: "30" },
      ],
    });
    const r = (await botTools(ctx).find((t) => t.name === "get_mileage")!.handler(ctx.cfg, { month: "2026-10", words: "keeler" })) as ReturnType<typeof summarizeMileage>;
    expect(callAppsScriptOrThrow).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "listMileage", requesterEmail: "ty@ascentbuildingco.com", month: "2026-10" }),
      expect.anything(),
    );
    expect(r).toMatchObject({ trips: 2, totalMiles: 22.5, byJob: [{ name: "Keeler - Remodel", miles: 22.5, trips: 2 }] });
    expect(JSON.stringify(r)).not.toMatch(/Polyline|abc|Lat/);
  });
});
