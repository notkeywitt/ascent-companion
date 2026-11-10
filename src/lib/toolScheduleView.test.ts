import { describe, expect, it } from "vitest";
import { matchesAllWords } from "./searchWords";
import type { DemandSpan, KindSchedule } from "./toolSchedule";
import { viewIdForPath, ROLE_VIEWS } from "./views";
import {
  assignLanes,
  compareText,
  filterScheduleByJobs,
  jobColourIndex,
  jobsInView,
  mondayOf,
  needsOnDay,
  sortKinds,
  sortRules,
  sortUnresolved,
  weeksOfNeed,
} from "./toolScheduleView";

const span = (jobId: string, startDate: string, endDate: string, qty = 1): DemandSpan => ({
  kindId: "k",
  jobId,
  jobName: jobId.toUpperCase(),
  startDate,
  endDate,
  qty,
  source: { type: "task", taskId: `${jobId}${startDate}`, taskName: "t", via: "name" },
});
const row = (spans: DemandSpan[], owned = 1, name = "Saw"): KindSchedule => ({
  kindId: name,
  name,
  owned,
  spans,
  shortfalls: [],
  missing: false,
});

describe("assignLanes", () => {
  it("stacks overlapping spans and reuses a lane once it is free", () => {
    const { spans, lanes } = assignLanes([
      span("a", "2026-12-01", "2026-12-05"),
      span("b", "2026-12-03", "2026-12-10"),
      span("c", "2026-12-06", "2026-12-08"),
    ]);
    expect(lanes).toBe(2);
    expect(spans.map((s) => [s.jobId, s.lane])).toEqual([["a", 0], ["b", 1], ["c", 0]]);
  });
  it("has one lane when there is nothing", () => {
    expect(assignLanes([]).lanes).toBe(1);
  });
});

describe("needsOnDay", () => {
  it("lists shortfalls first, then by name", () => {
    const out = needsOnDay(
      [row([span("a", "2026-12-01", "2026-12-05")], 1, "Alpha"), row([span("a", "2026-12-01", "2026-12-05"), span("b", "2026-12-02", "2026-12-03")], 1, "Zulu")],
      "2026-12-02",
    );
    expect(out.map((n) => [n.name, n.need, n.short])).toEqual([["Zulu", 2, true], ["Alpha", 1, false]]);
    expect(needsOnDay([row([span("a", "2026-12-01", "2026-12-05")])], "2026-12-09")).toEqual([]);
  });
});

describe("weeksOfNeed", () => {
  it("groups by Monday week, skips empty weeks and keeps the week's peak", () => {
    const weeks = weeksOfNeed([row([span("a", "2026-11-11", "2026-11-12"), span("b", "2026-11-12", "2026-11-13"), span("a", "2026-11-30", "2026-12-01")])], "2026-11-10", "2026-12-31");
    expect(weeks.map((w) => [w.week, w.needs[0].need, w.needs[0].short])).toEqual([
      ["2026-11-09", 2, true],
      ["2026-11-30", 1, false],
    ]);
  });
});

describe("mondayOf / jobColourIndex", () => {
  it("finds the Monday, and gives each job a stable colour slot", () => {
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // a Sunday
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect([...jobColourIndex(["a", "b", "a", "c"])]).toEqual([["a", 0], ["b", 1], ["c", 2]]);
  });
});

describe("tool schedule gating", () => {
  it("lets everyone read the schedule, and keeps editing to the edit view", () => {
    expect(viewIdForPath("/tool-schedule")).toBe("tool-schedule");
    expect(viewIdForPath("/api/tool-schedule")).toBe("tool-schedule");
    expect(viewIdForPath("/tool-schedule/edit")).toBe("tool-schedule-edit");
    for (const p of ["catalog", "rules", "holds", "jobs"]) expect(viewIdForPath(`/api/tool-schedule/${p}`)).toBe("tool-schedule-edit");
    expect(ROLE_VIEWS.field).toContain("tool-schedule");
    expect(ROLE_VIEWS.field).not.toContain("tool-schedule-edit");
    expect(ROLE_VIEWS.lead).not.toContain("tool-schedule-edit");
    expect(ROLE_VIEWS.office).toContain("tool-schedule-edit");
  });
});

describe("filterScheduleByJobs", () => {
  const spans = [span("studio", "2026-12-01", "2026-12-10"), span("main", "2026-12-05", "2026-12-20")];
  const moves = [
    { kindId: "Saw", kindName: "Saw", jobId: "studio", jobName: "STUDIO", by: "2026-12-01", toolsAt: [] },
    { kindId: "Saw", kindName: "Saw", jobId: "main", jobName: "MAIN", by: "2026-12-05", toolsAt: [] },
  ];
  const from = "2026-11-10";
  const to = "2027-05-09";

  it("returns the data untouched when nothing is hidden", () => {
    const rows = [row(spans)];
    expect(filterScheduleByJobs(rows, moves, new Set(), from, to)).toEqual({ rows, moves });
  });
  it("finds the conflict from the spans while both jobs show, and loses it when one is hidden", () => {
    const shown = filterScheduleByJobs([row(spans)], moves, new Set(["nobody"]), from, to).rows[0];
    expect(shown.shortfalls).toMatchObject([{ startDate: "2026-12-05", endDate: "2026-12-10", need: 2, owned: 1 }]);
    expect(filterScheduleByJobs([row(spans)], moves, new Set(["main"]), from, to).rows[0].shortfalls).toEqual([]);
  });
  it("finds the shortfall again from the spans that remain", () => {
    const three = [span("a", "2026-12-01", "2026-12-05"), span("b", "2026-12-03", "2026-12-08"), span("c", "2026-12-04", "2026-12-06")];
    const out = filterScheduleByJobs([row(three)], [], new Set(["c"]), from, to).rows[0];
    expect(out.shortfalls).toMatchObject([{ startDate: "2026-12-03", endDate: "2026-12-05", need: 2, owned: 1 }]);
  });
  it("marks a tool type missing only while a shown job needs it", () => {
    const none = row(spans, 0);
    expect(filterScheduleByJobs([none], [], new Set(["studio"]), from, to).rows[0].missing).toBe(true);
    expect(filterScheduleByJobs([none], [], new Set(["studio", "main"]), from, to).rows[0]).toMatchObject({ missing: false, spans: [], shortfalls: [] });
  });
  it("drops a hidden job's moves and ignores an id it does not know", () => {
    const out = filterScheduleByJobs([row(spans)], moves, new Set(["studio", "nobody"]), from, to);
    expect(out.moves.map((m) => m.jobId)).toEqual(["main"]);
  });
});

describe("jobsInView", () => {
  it("adds a job that only has a hold, and sorts by name", () => {
    const rows = [row([span("hold-only", "2027-01-04", "2027-01-08")])];
    expect(jobsInView([{ id: "main", name: "Main House" }, { id: "barn", name: "Barn" }], rows)).toEqual([
      { id: "barn", name: "Barn" },
      { id: "hold-only", name: "HOLD-ONLY" },
      { id: "main", name: "Main House" },
    ]);
  });
});

describe("matchesAllWords", () => {
  it("needs every word, in any order, and matches an empty query", () => {
    const hay = "03 30 10 Cast-in-Place Concrete Slabs";
    expect(matchesAllWords(hay, "slab concrete")).toBe(true);
    expect(matchesAllWords(hay, "03 30")).toBe(true);
    expect(matchesAllWords(hay, "slab roofing")).toBe(false);
    expect(matchesAllWords(hay, "  ")).toBe(true);
  });
});

describe("sorting", () => {
  it("reads digits as numbers", () => {
    expect(["Saw 10", "Saw 2"].sort(compareText)).toEqual(["Saw 2", "Saw 10"]);
    expect(["06 20 13", "06 10 00"].sort(compareText)).toEqual(["06 10 00", "06 20 13"]);
  });
  it("sorts tool types by name, owned and rules using them, both ways", () => {
    const kinds = [
      { id: "a", name: "Saw" },
      { id: "b", name: "Mixer" },
      { id: "c", name: "Lift" },
    ];
    const own: Record<string, number> = { a: 1, b: 0, c: 1 };
    const use: Record<string, number> = { a: 3, b: 1, c: 0 };
    const ids = (k: typeof kinds) => k.map((x) => x.id);
    const o = (id: string) => own[id];
    const u = (id: string) => use[id];
    expect(ids(sortKinds(kinds, "name", "asc", o, u))).toEqual(["c", "b", "a"]);
    expect(ids(sortKinds(kinds, "name", "desc", o, u))).toEqual(["a", "b", "c"]);
    expect(ids(sortKinds(kinds, "owned", "asc", o, u))).toEqual(["b", "c", "a"]);
    expect(ids(sortKinds(kinds, "uses", "desc", o, u))).toEqual(["a", "b", "c"]);
  });
  it("sorts unresolved task names by tasks, name, job and phase", () => {
    const list = [
      { name: "Burn", phase: "", jobNames: ["Main House"], taskIds: ["1"] },
      { name: "Strip", phase: "Site Prep", jobNames: ["Studio", "Pre"], taskIds: ["2", "3"] },
      { name: "Anchor", phase: "Framing", jobNames: ["Barn"], taskIds: ["4"] },
    ];
    const names = (l: typeof list) => l.map((x) => x.name);
    expect(names(sortUnresolved(list, "tasks", "desc"))).toEqual(["Strip", "Anchor", "Burn"]); // the tie reads A–Z
    expect(names(sortUnresolved(list, "tasks", "asc"))).toEqual(["Anchor", "Burn", "Strip"]);
    expect(names(sortUnresolved(list, "name", "asc"))).toEqual(["Anchor", "Burn", "Strip"]);
    expect(names(sortUnresolved(list, "job", "asc"))).toEqual(["Anchor", "Burn", "Strip"]);
    expect(names(sortUnresolved(list, "phase", "desc"))).toEqual(["Strip", "Anchor", "Burn"]);
  });
  it("sorts rules by name, type and tools, with no-tool rules first", () => {
    const names: Record<string, string> = { x: "Table saw", y: "Concrete mixer" };
    const rules = [
      { match: "name", key: "footings", label: "Footings", kindIds: ["y"] },
      { match: "phase", key: "framing", label: "Framing", kindIds: ["x"] },
      { match: "name", key: "inspection", label: "Inspection", kindIds: [] as string[] },
    ];
    const labels = (r: typeof rules) => r.map((x) => x.label);
    const tools = (ids: string[]) => ids.map((id) => names[id]).join(", ");
    expect(labels(sortRules(rules, "name", "asc", tools))).toEqual(["Footings", "Framing", "Inspection"]);
    expect(labels(sortRules(rules, "type", "asc", tools))).toEqual(["Footings", "Inspection", "Framing"]);
    expect(labels(sortRules(rules, "tools", "asc", tools))).toEqual(["Inspection", "Footings", "Framing"]);
    expect(labels(sortRules(rules, "tools", "desc", tools))).toEqual(["Framing", "Footings", "Inspection"]);
  });
});
