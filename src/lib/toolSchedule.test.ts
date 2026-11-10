import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "@/lib/jobtread";
import {
  buildDemand,
  buildRuleIndex,
  findMoves,
  findShortfalls,
  isPlaceId,
  isUsable,
  matchJobByLabel,
  monthsAhead,
  normalizeTaskName,
  parseTarget,
  placeId,
  resolveTaskTools,
  scheduleByKind,
  suggestTools,
  toolTarget,
  typeKey,
  typeTarget,
  UNTYPED,
  type DemandSpan,
  type KindSchedule,
  type OwnedTool,
  type TaskToolRule,
  type ToolKind,
} from "./toolSchedule";

const task = (p: Partial<ScheduleTask>): ScheduleTask => ({
  id: "t1",
  name: "Footings",
  phase: "Site Prep & Foundation",
  taskTypeId: null,
  taskTypeName: null,
  startDate: "2026-12-01",
  endDate: "2026-12-05",
  progress: null,
  jobId: "studio",
  jobName: "Studio",
  ...p,
});

// The catalogue: Tools-list tools typed by ToolType.
const tools: OwnedTool[] = [
  { id: "tool079", kindId: "compressor", name: "Makita MAC2400", condition: "New", locationLabel: "Shop", jobId: null },
  { id: "tool035", kindId: "compressor", name: "Makita 4.2 Gallon", condition: "New", locationLabel: "Gormley - Studio", jobId: "studio" },
  { id: "tool021", kindId: "laser level", name: "Dewalt Green Laser", condition: "Good", locationLabel: "Shop", jobId: null },
  { id: "tool999", kindId: "saw", name: "Old saw", condition: "Broken", locationLabel: "Shop", jobId: null },
];
const kinds: ToolKind[] = [
  { id: "compressor", name: "Compressor" },
  { id: "laser level", name: "Laser Level" },
  { id: "saw", name: "Saw" },
  { id: "scissor lift", name: "Scissor lift" },
];

describe("names and targets", () => {
  it("ignores case, punctuation, & vs and, and asides in brackets", () => {
    expect(normalizeTaskName("Wall Framing & Sheathing")).toBe("wall framing and sheathing");
    expect(normalizeTaskName("Install Underground Conduit (if needed)")).toBe("install underground conduit");
    expect(normalizeTaskName("Install Garage Door(s)")).toBe("install garage door");
  });
  it("keys a ToolType however the sheet spells it, and files a blank one under No type", () => {
    expect(typeKey("Nailer ")).toBe(typeKey("nailer"));
    expect(typeKey("")).toBe(UNTYPED);
  });
  it("writes and reads targets", () => {
    expect(toolTarget("tool021")).toBe("tool:tool021");
    expect(typeTarget("Laser Level")).toBe("type:laser level");
    expect(parseTarget("tool:tool021")).toEqual({ tool: "tool021" });
    expect(parseTarget("type:laser level")).toEqual({ type: "laser level" });
    expect(parseTarget("none")).toBeNull();
    expect(parseTarget("tool:")).toBeNull();
  });
});

describe("resolveTaskTools", () => {
  const rules: TaskToolRule[] = [
    { match: "phase", key: "Site Prep & Foundation", targets: ["type:laser level"] },
    { match: "name", key: "footings", targets: ["tool:tool079"] },
    { match: "task", key: "t-override", targets: ["type:saw"] },
    { match: "taskType", key: "type-framing", targets: ["type:compressor"] },
    { match: "name", key: "Footing Inspection", targets: [] },
  ];
  const idx = buildRuleIndex(rules);
  const targets = (t: ScheduleTask) => resolveTaskTools(t, idx)?.needs.map((n) => n.target);

  it("adds a task name's tools to its phase's, on every job", () => {
    expect(targets(task({ name: "FOOTINGS", jobId: "main" }))).toEqual(["tool:tool079", "type:laser level"]);
    expect(resolveTaskTools(task({}), idx)?.via).toBe("name");
  });
  it("adds every level, most specific first, and records which rule asked", () => {
    const res = resolveTaskTools(task({ id: "t-override", taskTypeId: "type-framing" }), idx)!;
    expect(res.needs.map((n) => [n.target, n.via, n.ruleKey])).toEqual([
      ["type:saw", "task", "task:t-override"],
      ["tool:tool079", "name", "name:footings"],
      ["type:compressor", "taskType", "taskType:type-framing"],
      ["type:laser level", "phase", "phase:site prep and foundation"],
    ]);
  });
  it("lets 'needs no tools' drop what its phase would add", () => {
    expect(resolveTaskTools(task({ name: "Footing Inspection" }), idx)).toEqual({ needs: [], via: "name" });
  });
  it("covers a task by its phase alone, and returns null when nothing matches", () => {
    expect(targets(task({ name: "Strip Topsoil" }))).toEqual(["type:laser level"]);
    expect(resolveTaskTools(task({ name: "Burn and Learn", phase: "" }), idx)).toBeNull();
  });
});

describe("suggestTools", () => {
  const rules: TaskToolRule[] = [
    { match: "name", key: "Footings", targets: ["type:laser level"] },
    { match: "name", key: "Wall Framing & Sheathing", targets: ["tool:tool079", "type:saw"] },
  ];
  it("lends what mapped names that share words ask for", () => {
    expect(suggestTools({ name: "Pour Footings", phase: "" }, rules, kinds, tools)).toEqual(["type:laser level"]);
    expect(suggestTools({ name: "Roof Framing", phase: "" }, rules, kinds, tools)).toEqual(["tool:tool079", "type:saw"]);
  });
  it("offers a tool type whose own name is in the task", () => {
    expect(suggestTools({ name: "Set up the laser level", phase: "" }, [], kinds, tools)).toEqual(["type:laser level"]);
  });
  it("suggests nothing when no word is shared, and drops a tool no longer listed", () => {
    expect(suggestTools({ name: "Burn and Learn", phase: "" }, rules, kinds, tools)).toEqual([]);
    expect(suggestTools({ name: "Roof Framing", phase: "" }, rules, kinds, [])).toEqual(["type:saw"]);
  });
});

describe("buildDemand", () => {
  const rules: TaskToolRule[] = [
    { match: "name", key: "Footings", targets: ["tool:tool021", "type:compressor"] },
    { match: "phase", key: "Framing", targets: ["type:saw", "type:scissor lift"] },
    { match: "name", key: "Final Inspection", targets: [] },
    { match: "name", key: "Gone", targets: ["tool:tool-deleted"] },
  ];

  it("gives a specific tool its own span on its type's row, and a type a span with no tool", () => {
    const { spans } = buildDemand([task({})], rules, tools);
    expect(spans.map((s) => [s.kindId, s.toolId ?? null, s.toolName ?? null])).toEqual([
      ["laser level", "tool021", "Dewalt Green Laser"],
      ["compressor", null, null],
    ]);
    expect(spans[0].source).toMatchObject({ type: "task", taskId: "t1", via: "name", ruleKey: "name:footings" });
  });
  it("counts a type nobody owns, so 'none owned' can show", () => {
    const { spans } = buildDemand([task({ name: "Wall Sheathing", phase: "Framing" })], rules, tools);
    expect(spans.map((s) => s.kindId).sort()).toEqual(["saw", "scissor lift"]);
  });
  it("adds no span for 'needs no tools' or a tool no longer in the Tools list", () => {
    const { spans, unresolved } = buildDemand([task({ name: "Final Inspection" }), task({ name: "Gone" })], rules, tools);
    expect(spans).toEqual([]);
    expect(unresolved).toEqual([]);
  });
  it("groups unresolved tasks by name across jobs, most common first", () => {
    const { unresolved } = buildDemand(
      [
        task({ id: "a", name: "Strip Topsoil & Stockpile", jobName: "Studio" }),
        task({ id: "b", name: "strip topsoil and stockpile", jobId: "pre", jobName: "Studio PreCon" }),
        task({ id: "c", name: "Burn and Learn", phase: "", jobId: "main", jobName: "Main House" }),
      ],
      rules,
      tools,
    );
    expect(unresolved.map((u) => [u.name, u.jobNames, u.taskIds])).toEqual([
      ["Strip Topsoil & Stockpile", ["Studio", "Studio PreCon"], ["a", "b"]],
      ["Burn and Learn", ["Main House"], ["c"]],
    ]);
  });
  it("adds bookings for a tool or a type, for a job or a place", () => {
    const { spans } = buildDemand([], rules, tools, [
      { id: "h1", target: "type:compressor", jobId: "main", jobName: "Main House", startDate: "2027-01-04", endDate: "2027-01-08", qty: 2, note: "" },
      { id: "h2", target: "tool:tool021", jobId: "", jobName: "Out for repair", startDate: "2027-01-05", endDate: "2027-01-20", qty: 3, note: "lens" },
      { id: "h3", target: "tool:tool-deleted", jobId: "main", jobName: "Main House", startDate: "2027-01-04", endDate: "2027-01-08", qty: 1, note: "" },
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ kindId: "compressor", jobId: "main", qty: 2, source: { type: "hold", holdId: "h1" } });
    expect(spans[1]).toMatchObject({ kindId: "laser level", toolId: "tool021", jobId: "place:out for repair", qty: 1 });
  });
});

describe("placeId", () => {
  it("files a place under one id whatever its case, and is told apart from a job", () => {
    expect(placeId("Out for Repair")).toBe(placeId("out for repair"));
    expect(isPlaceId(placeId("Shop"))).toBe(true);
    expect(isPlaceId("22PfLYbZq4Jt")).toBe(false);
  });
});

const span = (jobId: string, startDate: string, endDate: string, p: Partial<DemandSpan> = {}): DemandSpan => ({
  kindId: "k",
  jobId,
  jobName: jobId,
  startDate,
  endDate,
  qty: 1,
  source: { type: "task", taskId: `${jobId}-${startDate}`, taskName: "x", via: "name", ruleKey: "name:x" },
  ...p,
});
const own = (...ids: string[]) => new Set(ids);

describe("findShortfalls — any tool of a type", () => {
  it("finds the overlap where two jobs need the only one", () => {
    const out = findShortfalls([span("studio", "2026-11-30", "2026-12-04"), span("main", "2026-12-01", "2026-12-18")], own("a"), "2026-11-10", "2027-05-10");
    expect(out).toEqual([{ startDate: "2026-12-01", endDate: "2026-12-04", need: 2, owned: 1, jobIds: ["studio", "main"], tools: [] }]);
  });
  it("counts a job once a day, however many of its tasks overlap", () => {
    expect(findShortfalls([span("studio", "2026-12-01", "2026-12-05"), span("studio", "2026-12-03", "2026-12-08")], own("a"), "2026-12-01", "2026-12-31")).toEqual([]);
  });
  it("counts a booking's quantity", () => {
    expect(findShortfalls([span("main", "2027-01-04", "2027-01-06", { qty: 2 })], own("a"), "2027-01-01", "2027-01-31")).toMatchObject([{ need: 2 }]);
  });
  it("joins adjacent short days and keeps the peak need", () => {
    const out = findShortfalls(
      [span("a", "2027-01-01", "2027-01-10"), span("b", "2027-01-05", "2027-01-10"), span("c", "2027-01-08", "2027-01-12")],
      own("x"),
      "2027-01-01",
      "2027-01-31",
    );
    expect(out).toMatchObject([{ startDate: "2027-01-05", endDate: "2027-01-10", need: 3, jobIds: ["a", "b", "c"] }]);
  });
  it("clips to the range, and treats any need as short when none is owned", () => {
    expect(findShortfalls([span("a", "2026-11-01", "2026-11-20"), span("b", "2026-11-01", "2026-11-20")], own("x"), "2026-11-10", "2026-11-15")).toMatchObject([
      { startDate: "2026-11-10", endDate: "2026-11-15" },
    ]);
    expect(findShortfalls([span("a", "2027-03-01", "2027-03-02")], own(), "2027-03-01", "2027-03-31")).toHaveLength(1);
  });
});

describe("findShortfalls — specific tools", () => {
  it("flags one tool named by two jobs at once, even with others free", () => {
    const out = findShortfalls(
      [span("studio", "2026-12-01", "2026-12-05", { toolId: "a" }), span("main", "2026-12-04", "2026-12-08", { toolId: "a" })],
      own("a", "b", "c"),
      "2026-12-01",
      "2026-12-31",
    );
    expect(out).toEqual([{ startDate: "2026-12-04", endDate: "2026-12-05", need: 2, owned: 3, jobIds: ["studio", "main"], tools: ["a"] }]);
  });
  it("flags a broken tool the moment a job names it", () => {
    expect(findShortfalls([span("studio", "2026-12-01", "2026-12-01", { toolId: "broken" })], own("a"), "2026-12-01", "2026-12-31")).toMatchObject([{ tools: ["broken"] }]);
  });
  it("takes a named tool out of the pool for 'any of the type'", () => {
    const named = span("studio", "2026-12-01", "2026-12-05", { toolId: "a" });
    expect(findShortfalls([named, span("main", "2026-12-01", "2026-12-05")], own("a", "b"), "2026-12-01", "2026-12-31")).toEqual([]);
    expect(findShortfalls([named, span("main", "2026-12-01", "2026-12-05"), span("barn", "2026-12-03", "2026-12-03")], own("a", "b"), "2026-12-01", "2026-12-31")).toMatchObject([
      { startDate: "2026-12-03", endDate: "2026-12-03", need: 3, tools: [] },
    ]);
  });
  it("lets a job's named tool cover its own 'any' need", () => {
    expect(findShortfalls([span("studio", "2026-12-01", "2026-12-05", { toolId: "a" }), span("studio", "2026-12-01", "2026-12-05")], own("a"), "2026-12-01", "2026-12-31")).toEqual([]);
  });
});

describe("scheduleByKind", () => {
  it("counts only usable tools, flags a type with none owned, and rows a type only a span names", () => {
    const rows = scheduleByKind(
      [{ id: "saw", name: "Saw" }, { id: "compressor", name: "Compressor" }],
      [span("a", "2027-03-01", "2027-03-02", { kindId: "saw" }), span("a", "2027-03-01", "2027-03-02", { kindId: "mystery" })],
      tools,
      "2027-03-01",
      "2027-03-31",
    );
    expect(rows.map((r) => [r.kindId, r.owned, r.missing, r.usableToolIds])).toEqual([
      ["saw", 0, true, []],
      ["compressor", 2, false, ["tool079", "tool035"]],
      ["mystery", 0, true, []],
    ]);
  });
  it("leaves out spans outside the range", () => {
    const rows = scheduleByKind([{ id: "k", name: "Saw" }], [span("a", "2026-01-01", "2026-01-05")], [], "2026-11-10", "2027-05-10");
    expect(rows[0]).toMatchObject({ spans: [], missing: false, shortfalls: [] });
  });
});

describe("matchJobByLabel", () => {
  const jobs = [
    { id: "studio", name: "Studio" },
    { id: "pre", name: "Studio PreCon" },
    { id: "main", name: "Main House" },
    { id: "m2", name: "Main House" },
  ];
  it("matches the project part of a 'Customer - Project' label, or a bare name", () => {
    expect(matchJobByLabel("Gormley - Studio", jobs)).toBe("studio");
    expect(matchJobByLabel("Gormley - Studio PreCon", jobs)).toBe("pre");
    expect(matchJobByLabel("studio", jobs)).toBe("studio");
  });
  it("returns null for the shop, a blank, or a name two jobs share", () => {
    expect(matchJobByLabel("Shop", jobs)).toBeNull();
    expect(matchJobByLabel("", jobs)).toBeNull();
    expect(matchJobByLabel("Berger - Main House", jobs)).toBeNull();
  });
});

describe("findMoves", () => {
  const row = (kindId: string, spans: DemandSpan[]): KindSchedule => ({ kindId, name: kindId, owned: 1, usableToolIds: [], spans, shortfalls: [], missing: false });
  const from = "2026-11-10";
  const to = "2027-05-10";
  it("moves a named tool to each job that needs it, from wherever it is", () => {
    const out = findMoves([row("laser level", [span("main", "2026-12-07", "2026-12-31", { kindId: "laser level", toolId: "tool021" })])], tools, from, to);
    expect(out).toEqual([
      { kindId: "laser level", kindName: "laser level", toolId: "tool021", toolName: "Dewalt Green Laser", jobId: "main", jobName: "main", by: "2026-12-07", toolsAt: [{ name: "Dewalt Green Laser", at: "Shop" }] },
    ]);
  });
  it("says nothing when the named tool, or one of the type, is already there", () => {
    expect(findMoves([row("compressor", [span("studio", "2026-12-07", "2026-12-31", { kindId: "compressor", toolId: "tool035" })])], tools, from, to)).toEqual([]);
    expect(findMoves([row("compressor", [span("studio", "2026-12-07", "2026-12-31", { kindId: "compressor" })])], tools, from, to)).toEqual([]);
  });
  it("moves 'any of the type' to a job with none there, from the range start when under way", () => {
    const out = findMoves([row("compressor", [span("main", "2026-11-01", "2026-11-20", { kindId: "compressor" })])], tools, from, to);
    expect(out).toMatchObject([{ jobId: "main", by: "2026-11-10", toolsAt: [{ at: "Shop" }, { at: "Gormley - Studio" }] }]);
    expect(out[0].toolId).toBeUndefined();
  });
  it("gives no move for a place, or for a type with none usable", () => {
    expect(findMoves([row("compressor", [span(placeId("Shop"), "2026-12-01", "2026-12-05", { kindId: "compressor" })])], tools, from, to)).toEqual([]);
    expect(findMoves([row("saw", [span("main", "2026-12-01", "2026-12-05", { kindId: "saw" })])], tools, from, to)).toEqual([]);
  });
});

describe("isUsable / monthsAhead", () => {
  it("rules out broken, in-repair and lost tools", () => {
    expect(isUsable("Broken")).toBe(false);
    expect(isUsable("Out for repair")).toBe(false);
    expect(isUsable("Lost")).toBe(false);
    expect(isUsable("Good")).toBe(true);
    expect(isUsable(undefined)).toBe(true);
  });
  it("runs to the day before the same date N months on", () => {
    expect(monthsAhead("2026-11-10", 6)).toBe("2027-05-09");
    expect(monthsAhead("2026-08-31", 6)).toBe("2027-02-27");
  });
});
