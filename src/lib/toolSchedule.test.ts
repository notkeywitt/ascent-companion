import { describe, expect, it } from "vitest";
import type { CostCodeRef, ScheduleTask } from "@/lib/jobtread";
import {
  buildDemand,
  buildRuleIndex,
  findShortfalls,
  isUsable,
  normalizeTaskName,
  resolveTaskCode,
  scheduleByKind,
  suggestCodes,
  type DemandSpan,
  type TaskCodeRule,
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

const CONCRETE = "cc-0330";
const FRAMING = "cc-0610";
const SLABS = "cc-0331";

const codes: CostCodeRef[] = [
  { id: CONCRETE, number: "03 30 00", name: "Cast-in-Place Concrete Footings & Foundations" },
  { id: SLABS, number: "03 30 10", name: "Cast-in-Place Concrete Slabs" },
  { id: FRAMING, number: "06 10 00", name: "Rough Carpentry" },
  { id: "cc-0746", number: "07 46 46", name: "Fiber-Cement Siding" },
  { id: "cc-0710", number: "07 10 00", name: "Dampproofing and Waterproofing" },
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

describe("resolveTaskCode", () => {
  const rules: TaskCodeRule[] = [
    { match: "phase", key: "Site Prep & Foundation", costCodeId: SLABS },
    { match: "name", key: "footings", costCodeId: CONCRETE },
    { match: "task", key: "t-override", costCodeId: FRAMING },
    { match: "taskType", key: "type-framing", costCodeId: FRAMING },
    { match: "name", key: "Client Walkthrough", costCodeId: null },
  ];
  const idx = buildRuleIndex(rules);

  it("matches a task name on every job, whatever its case", () => {
    expect(resolveTaskCode(task({ name: "FOOTINGS", jobId: "main" }), idx)).toEqual({ costCodeId: CONCRETE, via: "name" });
  });
  it("lets a per-task override beat the name rule", () => {
    expect(resolveTaskCode(task({ id: "t-override" }), idx)).toEqual({ costCodeId: FRAMING, via: "task" });
  });
  it("tries the name, then the task type, then the phase", () => {
    expect(resolveTaskCode(task({ name: "Something else", taskTypeId: "type-framing" }), idx)?.via).toBe("taskType");
    expect(resolveTaskCode(task({ name: "Something else" }), idx)).toEqual({ costCodeId: SLABS, via: "phase" });
  });
  it("keeps 'needs no tools' as resolved, with no code", () => {
    expect(resolveTaskCode(task({ name: "Client walkthrough", phase: "" }), idx)).toEqual({ costCodeId: null, via: "name" });
  });
  it("returns null when nothing matches", () => {
    expect(resolveTaskCode(task({ name: "Burn and Learn", phase: "" }), idx)).toBeNull();
  });
});

describe("suggestCodes", () => {
  it("ranks codes that share words with the task name first", () => {
    expect(suggestCodes({ name: "Pour Footings", phase: "" }, codes)[0].id).toBe(CONCRETE);
    expect(suggestCodes({ name: "Install Siding & Trim", phase: "Exterior" }, codes)[0].number).toBe("07 46 46");
    expect(suggestCodes({ name: "Waterproofing and drainmatt", phase: "" }, codes)[0].number).toBe("07 10 00");
  });
  it("suggests nothing when no word is shared", () => {
    expect(suggestCodes({ name: "Burn and Learn", phase: "" }, codes)).toEqual([]);
  });
});

describe("buildDemand", () => {
  const kinds: ToolKind[] = [
    { id: "mixer", name: "Concrete mixer", costCodeIds: [CONCRETE, SLABS] },
    { id: "saw", name: "Table saw", costCodeIds: [FRAMING] },
    { id: "laser", name: "Laser level", costCodeIds: [CONCRETE, FRAMING] },
  ];
  const rules: TaskCodeRule[] = [
    { match: "name", key: "Footings", costCodeId: CONCRETE },
    { match: "name", key: "Wall Framing & Sheathing", costCodeId: FRAMING },
    { match: "name", key: "Final Inspection", costCodeId: null },
  ];

  it("gives a task one span per tool type its code needs", () => {
    const { spans } = buildDemand([task({})], rules, kinds);
    expect(spans.map((s) => s.kindId).sort()).toEqual(["laser", "mixer"]);
    expect(spans[0].source).toMatchObject({ type: "task", taskId: "t1", costCodeId: CONCRETE });
  });
  it("adds no span for 'needs no tools' or a code no tool type lists", () => {
    const { spans, unresolved } = buildDemand(
      [task({ name: "Final Inspection" }), task({ name: "Footings" })],
      rules,
      [{ id: "saw", name: "Table saw", costCodeIds: [FRAMING] }],
    );
    expect(spans).toEqual([]);
    expect(unresolved).toEqual([]);
  });
  it("groups unresolved tasks by name across jobs, most common first", () => {
    const { unresolved } = buildDemand(
      [
        task({ id: "a", name: "Strip Topsoil & Stockpile", jobName: "Studio" }),
        task({ id: "b", name: "strip topsoil and stockpile", jobId: "pre", jobName: "Studio PreCon" }),
        task({ id: "c", name: "Burn and Learn", jobId: "main", jobName: "Main House" }),
      ],
      rules,
      kinds,
    );
    expect(unresolved.map((u) => [u.name, u.jobNames, u.taskIds])).toEqual([
      ["Strip Topsoil & Stockpile", ["Studio", "Studio PreCon"], ["a", "b"]],
      ["Burn and Learn", ["Main House"], ["c"]],
    ]);
  });
  it("adds holds, and drops a hold for a tool type that no longer exists", () => {
    const { spans } = buildDemand([], rules, kinds, [
      { id: "h1", kindId: "saw", jobId: "main", jobName: "Main House", startDate: "2027-01-04", endDate: "2027-01-08", qty: 2, note: "" },
      { id: "h2", kindId: "gone", jobId: "main", jobName: "Main House", startDate: "2027-01-04", endDate: "2027-01-08", qty: 1, note: "" },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kindId: "saw", qty: 2, source: { type: "hold", holdId: "h1" } });
  });
});

const span = (jobId: string, startDate: string, endDate: string, qty = 1): DemandSpan => ({
  kindId: "k",
  jobId,
  jobName: jobId,
  startDate,
  endDate,
  qty,
  source: { type: "task", taskId: `${jobId}-${startDate}`, taskName: "x", costCodeId: "c" },
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
      { id: "k", name: "Plate compactor", costCodeIds: [] },
      { id: "z", name: "Tile saw", costCodeIds: [] },
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
    const rows = scheduleByKind([{ id: "k", name: "Saw", costCodeIds: [] }], [span("a", "2026-01-01", "2026-01-05")], [], "2026-11-10", "2027-05-10");
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
