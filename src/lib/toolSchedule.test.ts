import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "@/lib/jobtread";
import {
  buildDemand,
  buildRuleIndex,
  findMoves,
  findShortfalls,
  isPlaceId,
  matchJobByLabel,
  isUsable,
  normalizeTaskName,
  placeId,
  resolveTaskTools,
  scheduleByKind,
  suggestTools,
  type DemandSpan,
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

const kinds: ToolKind[] = [
  { id: "mixer", name: "Concrete mixer" },
  { id: "saw", name: "Table saw" },
  { id: "laser", name: "Laser level" },
  { id: "nailer", name: "Framing nailer" },
];

describe("normalizeTaskName", () => {
  it("ignores case, punctuation, & vs and, and asides in brackets", () => {
    expect(normalizeTaskName("Wall Framing & Sheathing")).toBe("wall framing and sheathing");
    expect(normalizeTaskName("wall framing AND sheathing.")).toBe("wall framing and sheathing");
    expect(normalizeTaskName("Install Underground Conduit (if needed)")).toBe("install underground conduit");
    expect(normalizeTaskName("Install Garage Door(s)")).toBe("install garage door");
    expect(normalizeTaskName("  ")).toBe("");
  });
});

describe("resolveTaskTools", () => {
  const rules: TaskToolRule[] = [
    { match: "phase", key: "Site Prep & Foundation", kindIds: ["laser"] },
    { match: "name", key: "footings", kindIds: ["mixer", "laser"] },
    { match: "task", key: "t-override", kindIds: ["saw"] },
    { match: "taskType", key: "type-framing", kindIds: ["nailer"] },
    { match: "name", key: "Client Walkthrough", kindIds: [] },
  ];
  const idx = buildRuleIndex(rules);

  it("gives a task name its tools on every job, whatever its case", () => {
    expect(resolveTaskTools(task({ name: "FOOTINGS", jobId: "main" }), idx)).toEqual({ kindIds: ["mixer", "laser"], via: "name" });
  });
  it("lets a per-task override beat the name rule", () => {
    expect(resolveTaskTools(task({ id: "t-override" }), idx)).toEqual({ kindIds: ["saw"], via: "task" });
  });
  it("tries the name, then the task type, then the phase", () => {
    expect(resolveTaskTools(task({ name: "Something else", taskTypeId: "type-framing" }), idx)?.via).toBe("taskType");
    expect(resolveTaskTools(task({ name: "Something else" }), idx)).toEqual({ kindIds: ["laser"], via: "phase" });
  });
  it("keeps 'needs no tools' as covered, with no tools", () => {
    expect(resolveTaskTools(task({ name: "Client walkthrough", phase: "" }), idx)).toEqual({ kindIds: [], via: "name" });
  });
  it("returns null when nothing matches", () => {
    expect(resolveTaskTools(task({ name: "Burn and Learn", phase: "" }), idx)).toBeNull();
  });
});

describe("suggestTools", () => {
  const rules: TaskToolRule[] = [
    { match: "name", key: "Footings", kindIds: ["mixer"] },
    { match: "name", key: "Wall Framing & Sheathing", kindIds: ["nailer", "saw"] },
    { match: "phase", key: "Framing & Rough-Ins", kindIds: ["nailer"] },
  ];
  it("lends the tools of mapped names that share words", () => {
    expect(suggestTools({ name: "Pour Footings", phase: "" }, rules, kinds)).toEqual(["mixer"]);
    expect(suggestTools({ name: "Roof Framing", phase: "" }, rules, kinds)[0]).toBe("nailer");
  });
  it("offers a tool type whose own name is in the task", () => {
    expect(suggestTools({ name: "Set up laser level", phase: "" }, [], kinds)).toEqual(["laser"]);
  });
  it("suggests nothing when no word is shared, and drops deleted tool types", () => {
    expect(suggestTools({ name: "Burn and Learn", phase: "" }, rules, kinds)).toEqual([]);
    expect(suggestTools({ name: "Pour Footings", phase: "" }, rules, kinds.filter((k) => k.id !== "mixer"))).toEqual([]);
  });
});

describe("buildDemand", () => {
  const rules: TaskToolRule[] = [
    { match: "name", key: "Footings", kindIds: ["mixer", "laser"] },
    { match: "phase", key: "Framing", kindIds: ["saw", "nailer"] },
    { match: "name", key: "Final Inspection", kindIds: [] },
  ];

  it("gives a task one span per tool its rule names", () => {
    const { spans } = buildDemand([task({})], rules, kinds);
    expect(spans.map((s) => s.kindId).sort()).toEqual(["laser", "mixer"]);
    expect(spans[0].source).toMatchObject({ type: "task", taskId: "t1", via: "name" });
  });
  it("covers every task in a mapped phase", () => {
    const { spans, unresolved } = buildDemand([task({ name: "Wall Sheathing", phase: "Framing" })], rules, kinds);
    expect(spans.map((s) => s.kindId).sort()).toEqual(["nailer", "saw"]);
    expect(spans[0].source).toMatchObject({ via: "phase" });
    expect(unresolved).toEqual([]);
  });
  it("adds no span for 'needs no tools' or a tool type since deleted", () => {
    const { spans, unresolved } = buildDemand(
      [task({ name: "Final Inspection" }), task({ name: "Footings" })],
      rules,
      [{ id: "saw", name: "Table saw" }],
    );
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
      kinds,
    );
    expect(unresolved.map((u) => [u.name, u.jobNames, u.taskIds])).toEqual([
      ["Strip Topsoil & Stockpile", ["Studio", "Studio PreCon"], ["a", "b"]],
      ["Burn and Learn", ["Main House"], ["c"]],
    ]);
  });
  it("adds bookings, for a job or a place, and drops one for a deleted tool type", () => {
    const { spans } = buildDemand([], rules, kinds, [
      { id: "h1", kindId: "saw", jobId: "main", jobName: "Main House", startDate: "2027-01-04", endDate: "2027-01-08", qty: 2, note: "" },
      { id: "h2", kindId: "saw", jobId: "", jobName: "Out for repair", startDate: "2027-01-05", endDate: "2027-01-20", qty: 1, note: "blade" },
      { id: "h3", kindId: "gone", jobId: "main", jobName: "Main House", startDate: "2027-01-04", endDate: "2027-01-08", qty: 1, note: "" },
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ kindId: "saw", jobId: "main", qty: 2, source: { type: "hold", holdId: "h1" } });
    expect(spans[1]).toMatchObject({ jobId: "place:out for repair", jobName: "Out for repair" });
  });
});

describe("placeId", () => {
  it("files a place under one id whatever its case, and is told apart from a job", () => {
    expect(placeId("Out for Repair")).toBe(placeId("out for repair"));
    expect(isPlaceId(placeId("Shop"))).toBe(true);
    expect(isPlaceId("22PfLYbZq4Jt")).toBe(false);
  });
});

const span = (jobId: string, startDate: string, endDate: string, qty = 1): DemandSpan => ({
  kindId: "k",
  jobId,
  jobName: jobId,
  startDate,
  endDate,
  qty,
  source: { type: "task", taskId: `${jobId}-${startDate}`, taskName: "x", via: "name" },
});

describe("findShortfalls", () => {
  it("finds the overlap where two jobs need the only tool", () => {
    const out = findShortfalls([span("studio", "2026-11-30", "2026-12-04"), span("main", "2026-12-01", "2026-12-18")], 1, "2026-11-10", "2027-05-10");
    expect(out).toEqual([{ startDate: "2026-12-01", endDate: "2026-12-04", need: 2, owned: 1, jobIds: ["studio", "main"] }]);
  });
  it("counts a job once a day, however many of its tasks overlap", () => {
    expect(findShortfalls([span("studio", "2026-12-01", "2026-12-05"), span("studio", "2026-12-03", "2026-12-08")], 1, "2026-12-01", "2026-12-31")).toEqual([]);
  });
  it("counts a hold's quantity", () => {
    const out = findShortfalls([span("main", "2027-01-04", "2027-01-06", 2)], 1, "2027-01-01", "2027-01-31");
    expect(out).toMatchObject([{ startDate: "2027-01-04", endDate: "2027-01-06", need: 2 }]);
  });
  it("joins adjacent short days and keeps the peak need", () => {
    const out = findShortfalls(
      [span("a", "2027-01-01", "2027-01-10"), span("b", "2027-01-05", "2027-01-10"), span("c", "2027-01-08", "2027-01-12")],
      1,
      "2027-01-01",
      "2027-01-31",
    );
    expect(out).toEqual([{ startDate: "2027-01-05", endDate: "2027-01-10", need: 3, owned: 1, jobIds: ["a", "b", "c"] }]);
  });
  it("clips to the range", () => {
    const out = findShortfalls([span("a", "2026-11-01", "2026-11-20"), span("b", "2026-11-01", "2026-11-20")], 1, "2026-11-10", "2026-11-15");
    expect(out).toMatchObject([{ startDate: "2026-11-10", endDate: "2026-11-15" }]);
  });
  it("treats any need as short when none is owned", () => {
    expect(findShortfalls([span("a", "2027-03-01", "2027-03-02")], 0, "2027-03-01", "2027-03-31")).toHaveLength(1);
  });
});

describe("scheduleByKind", () => {
  it("counts only usable tools and flags a tool type with none owned", () => {
    const kinds: ToolKind[] = [
      { id: "k", name: "Plate compactor" },
      { id: "z", name: "Tile saw" },
    ];
    const rows = scheduleByKind(
      kinds,
      [span("a", "2027-03-01", "2027-03-02")],
      [
        { id: "1", kindId: "k", condition: "Broken" },
        { id: "2", kindId: "z", condition: "Good" },
      ],
      "2027-03-01",
      "2027-03-31",
    );
    expect(rows[0]).toMatchObject({ owned: 0, missing: true });
    expect(rows[0].shortfalls).toHaveLength(1);
    expect(rows[1]).toMatchObject({ owned: 1, missing: false, spans: [] });
  });
  it("leaves out spans outside the range", () => {
    const rows = scheduleByKind([{ id: "k", name: "Saw" }], [span("a", "2026-01-01", "2026-01-05")], [], "2026-11-10", "2027-05-10");
    expect(rows[0]).toMatchObject({ spans: [], missing: false, shortfalls: [] });
  });
});

describe("isUsable", () => {
  it("rules out broken, in-repair and lost tools", () => {
    expect(isUsable("Broken")).toBe(false);
    expect(isUsable("Out for repair")).toBe(false);
    expect(isUsable("Lost")).toBe(false);
    expect(isUsable("Good")).toBe(true);
    expect(isUsable(undefined)).toBe(true);
  });
});

describe("matchJobByLabel", () => {
  const jobs = [
    { id: "studio", name: "Studio" },
    { id: "pre", name: "Studio PreCon" },
    { id: "main", name: "Main House" },
    { id: "m2", name: "Main House" },
  ];
  it("matches the project part of a 'Customer - Project' label", () => {
    expect(matchJobByLabel("Gormley - Studio", jobs)).toBe("studio");
    expect(matchJobByLabel("Gormley - Studio PreCon", jobs)).toBe("pre");
  });
  it("matches a bare job name", () => {
    expect(matchJobByLabel("studio", jobs)).toBe("studio");
  });
  it("returns null for the shop, a blank, or a name two jobs share", () => {
    expect(matchJobByLabel("Shop", jobs)).toBeNull();
    expect(matchJobByLabel("", jobs)).toBeNull();
    expect(matchJobByLabel("Berger - Main House", jobs)).toBeNull();
  });
});

describe("findMoves", () => {
  const row = (spans: DemandSpan[]) => ({ kindId: "k", name: "Table saw", owned: 1, spans, shortfalls: [], missing: false });
  it("flags a job that needs the tool when none is there, from its first day", () => {
    const out = findMoves(
      [row([span("studio", "2026-12-07", "2026-12-31"), span("studio", "2027-01-04", "2027-01-08")])],
      [{ id: "1", kindId: "k", name: "SawStop", locationLabel: "Shop", jobId: null }],
      "2026-11-10",
      "2027-05-10",
    );
    expect(out).toEqual([
      { kindId: "k", kindName: "Table saw", jobId: "studio", jobName: "studio", by: "2026-12-07", toolsAt: [{ name: "SawStop", at: "Shop" }] },
    ]);
  });
  it("says nothing when a usable tool is already at the job", () => {
    expect(findMoves([row([span("studio", "2026-12-07", "2026-12-31")])], [{ id: "1", kindId: "k", jobId: "studio" }], "2026-11-10", "2027-05-10")).toEqual([]);
  });
  it("uses the range start for a need already under way", () => {
    const out = findMoves([row([span("main", "2026-11-01", "2026-11-20")])], [{ id: "1", kindId: "k" }], "2026-11-10", "2027-05-10");
    expect(out[0].by).toBe("2026-11-10");
  });
  it("gives no move for a booking at a place that is not a job", () => {
    expect(findMoves([row([span(placeId("Shop"), "2026-12-01", "2026-12-05")])], [{ id: "1", kindId: "k" }], "2026-11-10", "2027-05-10")).toEqual([]);
  });
  it("gives no move when none is owned (that is 'missing')", () => {
    expect(findMoves([row([span("main", "2026-12-01", "2026-12-05")])], [{ id: "1", kindId: "k", condition: "Broken" }], "2026-11-10", "2027-05-10")).toEqual([]);
  });
});

describe("monthsAhead", () => {
  it("runs to the day before the same date N months on", async () => {
    const { monthsAhead } = await import("./toolSchedule");
    expect(monthsAhead("2026-11-10", 6)).toBe("2027-05-09");
    expect(monthsAhead("2026-11-10", 1)).toBe("2026-12-09");
    expect(monthsAhead("2026-08-31", 6)).toBe("2027-02-27");
  });
});
