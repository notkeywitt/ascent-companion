import { describe, expect, it } from "vitest";
import { buildRibbonJobs, daysInYear, isoWeekStartDay, spreadBack, topRibbonJobs, weekPosition } from "./yearRibbon";

describe("isoWeekStartDay", () => {
  it("places week 1 of 2026 on Monday Dec 29, 2025", () => {
    expect(isoWeekStartDay(2026, 1)).toBe(-3);
  });
  it("places week 47 of 2026 on Monday Nov 16", () => {
    // Nov 16 is day 319 (0-based) of 2026.
    expect(isoWeekStartDay(2026, 47)).toBe(319);
  });
  it("places week 1 of 2024 on Monday Jan 1", () => {
    expect(isoWeekStartDay(2024, 1)).toBe(0);
  });
});

describe("weekPosition", () => {
  it("stays inside the year", () => {
    expect(weekPosition(2026, 1)).toBeGreaterThanOrEqual(0);
    expect(weekPosition(2026, 53)).toBeLessThanOrEqual(1);
  });
  it("knows a leap year", () => {
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
  });
});

describe("buildRibbonJobs", () => {
  const name = (id: string) => `Job ${id}`;
  it("turns weekly minutes into hours per work day", () => {
    const [j] = buildRibbonJobs([{ week: 10, jobId: "a", value: 3000 }], [], name);
    expect(j.hours[10]).toBe(10);
    expect(j.name).toBe("Job a");
  });
  it("draws a credit week as zero and drops rows with no job", () => {
    const jobs = buildRibbonJobs(
      [],
      [
        { week: 5, jobId: "a", value: -50 },
        { week: 6, jobId: "", value: 99 },
      ],
      name,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].bills[5]).toBe(0);
  });
});

describe("spreadBack", () => {
  it("shares a month-end week over itself and the three weeks before", () => {
    const v = new Array(54).fill(0);
    v[9] = 400;
    const out = spreadBack(v);
    expect(out.slice(5, 11)).toEqual([0, 100, 100, 100, 100, 0]);
  });
  it("keeps the total when the spread reaches week 1", () => {
    const v = new Array(54).fill(0);
    v[2] = 400;
    const out = spreadBack(v);
    expect(out[1]).toBe(300);
    expect(out[2]).toBe(100);
    expect(out[0]).toBe(0);
  });
  it("spreads bills in buildRibbonJobs", () => {
    const [j] = buildRibbonJobs([], [{ week: 20, jobId: "a", value: 800 }], (id) => id);
    expect(j.bills[17]).toBe(200);
    expect(j.bills[20]).toBe(200);
  });
});

describe("topRibbonJobs", () => {
  it("keeps the largest and sums the rest into Other", () => {
    const rows = ["a", "b", "c"].map((id, i) => ({ week: 2, jobId: id, value: (3 - i) * 600 }));
    const out = topRibbonJobs(buildRibbonJobs(rows, [], (id) => id), 2);
    expect(out.map((j) => j.name)).toEqual(["a", "b", "Other"]);
    expect(out[2].hours[2]).toBe(2);
  });
});
