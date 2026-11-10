import { describe, expect, it } from "vitest";
import type { DemandSpan, KindSchedule } from "./toolSchedule";
import { viewIdForPath, ROLE_VIEWS } from "./views";
import { assignLanes, jobColourIndex, mondayOf, needsOnDay, weeksOfNeed } from "./toolScheduleView";

const span = (jobId: string, startDate: string, endDate: string, qty = 1): DemandSpan => ({
  kindId: "k",
  jobId,
  jobName: jobId.toUpperCase(),
  startDate,
  endDate,
  qty,
  source: { type: "task", taskId: `${jobId}${startDate}`, taskName: "t", costCodeId: "c" },
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
