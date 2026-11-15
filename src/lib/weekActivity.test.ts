import { describe, expect, it } from "vitest";
import { buildWeekActivity, busiestOn, nearness, weekDates } from "./weekActivity";

describe("weekDates", () => {
  it("runs Sunday to Saturday around a mid-week day", () => {
    expect(weekDates("2026-11-18")).toEqual([
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
  });
  it("keeps a Sunday as the first day and crosses a month end", () => {
    expect(weekDates("2026-11-29")[0]).toBe("2026-11-29");
    expect(weekDates("2026-11-29")[6]).toBe("2026-12-05");
  });
});

describe("buildWeekActivity", () => {
  const today = "2026-11-17"; // Tuesday
  const task = { id: "t1", name: "Framing", phase: "Rough", startDate: "2026-11-10", endDate: "2026-11-16", jobId: "a", jobName: "Barn" };

  it("counts a schedule task on every day it spans inside the week", () => {
    const w = buildWeekActivity(today, [task], []);
    expect(w.jobs[0].days.map((d) => d.length)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(w.jobs[0].total).toBe(2);
    expect(w.jobs[0].days[0][0]).toMatchObject({ kind: "task", phase: "Rough" });
  });

  it("counts a to-do once, on the day it is due", () => {
    const w = buildWeekActivity(today, [], [
      { id: "d1", name: "Order windows", startDate: "2026-11-01", endDate: "2026-11-19", jobId: "a", jobName: "Barn" },
      { id: "d2", name: "No date", jobId: "a", jobName: "Barn" },
      { id: "d3", name: "Next week", endDate: "2026-11-23", jobId: "a", jobName: "Barn" },
    ]);
    expect(w.jobs[0].days.map((d) => d.length)).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });

  it("sorts the busiest week first and names the busiest job of a day", () => {
    const w = buildWeekActivity(today, [task, { ...task, id: "t2", jobId: "b", jobName: "Shed", startDate: "2026-11-15", endDate: "2026-11-21" }], []);
    expect(w.jobs.map((j) => j.name)).toEqual(["Shed", "Barn"]);
    expect(busiestOn(w.jobs, 3)?.name).toBe("Shed");
    expect(busiestOn([], 3)).toBeNull();
  });
});

describe("nearness", () => {
  it("is full today and fades away from it", () => {
    expect(nearness(3, 3.5)).toBe(1);
    expect(nearness(4, 3.5)).toBeGreaterThan(nearness(5, 3.5));
    expect(nearness(2, 3.5)).toBeLessThan(nearness(4, 3.5));
  });
  it("sharpens tomorrow as today goes on", () => {
    expect(nearness(4, 3.9)).toBeGreaterThan(nearness(4, 3.1));
  });
});
