import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  axisTicks,
  barPct,
  byWindow,
  dateRange,
  scheduleHeadline,
  scheduleMeta,
  shortDate,
  spanPct,
  type JobSchedule,
} from "./jobBoard";

const task = (name: string, start: string, end: string) => ({ name, start, end });

// shortDate() drops the year only for the CURRENT year, so pin the clock —
// otherwise these expectations start failing on 1 January.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

describe("byWindow", () => {
  it("puts the leaf task before the phase that contains it", () => {
    const phase = task("Interior Finishes", "2026-05-11", "2026-09-22");
    const leaf = task("Interior Paint", "2026-08-31", "2026-09-10");
    expect(byWindow([phase, leaf]).map((t) => t.name)).toEqual([
      "Interior Paint",
      "Interior Finishes",
    ]);
  });
});

describe("spanPct", () => {
  it("measures today's position in the span", () => {
    expect(spanPct("2026-09-01", "2026-09-11", "2026-09-06")).toBeCloseTo(0.5);
  });
  it("clamps outside the span", () => {
    expect(spanPct("2026-09-01", "2026-09-11", "2026-08-01")).toBe(0);
    expect(spanPct("2026-09-01", "2026-09-11", "2026-12-01")).toBe(1);
  });
  it("reads a one-day span as done once today reaches it", () => {
    expect(spanPct("2026-09-06", "2026-09-06", "2026-09-06")).toBe(1);
    expect(spanPct("2026-09-06", "2026-09-06", "2026-09-05")).toBe(0);
  });
});

describe("the schedule line", () => {
  const base: JobSchedule = {
    start: "2025-07-09",
    end: "2026-11-12",
    pctElapsed: 0.62,
    now: [
      task("Interior Paint", "2026-08-31", "2026-09-10"),
      task("MEPs", "2026-03-27", "2026-11-12"),
    ],
    next: task("Appliances", "2026-09-21", "2026-09-22"),
  };

  it("leads with the task in flight and names its phase", () => {
    expect(scheduleHeadline(base)).toBe("Interior Paint");
    expect(scheduleMeta(base)).toEqual([
      "Aug 31 – Sep 10",
      "MEPs",
      "62% of schedule",
      "ends Nov 12",
    ]);
  });

  it("falls back to the next task when nothing is in flight", () => {
    const idle = { ...base, now: [] };
    expect(scheduleHeadline(idle)).toBe("Next: Appliances");
    expect(scheduleMeta(idle)[0]).toBe("Sep 21 – Sep 22");
  });

  it("says so when the schedule is spent or missing", () => {
    expect(scheduleHeadline({ ...base, now: [], next: null })).toBe("Schedule complete");
    expect(scheduleHeadline(null)).toBe("No schedule in JobTread");
    expect(scheduleMeta(null)).toEqual([]);
  });

  it("keeps the year on a date outside this one", () => {
    expect(shortDate("2027-10-15", 2026)).toBe("Oct 15, 2027");
    expect(shortDate("2026-10-15", 2026)).toBe("Oct 15");
  });

  it("prints a single-day bar as one date", () => {
    expect(dateRange(task("Footer Inspection", "2026-09-06", "2026-09-06"))).toBe("Sep 6");
  });
});

describe("gantt geometry", () => {
  // A 100-day span, so a percentage reads as "days in".
  const start = "2026-01-01";
  const end = "2026-04-10";

  it("places a bar by its own dates, last day included", () => {
    expect(barPct(start, end, "2026-01-01", "2026-01-01")).toEqual({ left: 0, width: 1 });
    const b = barPct(start, end, "2026-02-10", "2026-02-19");
    expect(b.left).toBeCloseTo(40);
    expect(b.width).toBeCloseTo(10);
  });

  it("clips a bar that runs past either end of the span", () => {
    const b = barPct(start, end, "2025-06-01", "2026-12-31");
    expect(b).toEqual({ left: 0, width: 100 });
    expect(barPct(start, end, "2027-01-01", "2027-02-01").width).toBe(0);
  });

  it("labels every month on a short span and every quarter on a long one", () => {
    expect(axisTicks(start, end).map((t) => t.label)).toEqual(["Jan 26", "Feb", "Mar", "Apr"]);
    // Every third month over a 27-month span, and January carries its year.
    const long = axisTicks("2025-07-09", "2027-10-15").map((t) => t.label);
    expect(long).toEqual(["Aug", "Nov", "Feb", "May", "Aug", "Nov", "Feb", "May", "Aug"]);
  });

  it("has nothing to label when the span is a single day", () => {
    expect(axisTicks("2026-09-06", "2026-09-06")).toEqual([]);
  });
});
