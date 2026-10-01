import { describe, expect, it } from "vitest";

import { buildGrid, endAfter, fmtClock, originalEnd, parseHours } from "./weekGrid";

const e = (o: Partial<Parameters<typeof buildGrid>[0][number]>) => ({
  id: "x",
  date: "2026-09-28",
  startTime: "08:00",
  endTime: "10:00",
  minutes: 120,
  jobId: "j1",
  jobName: "Bunkhouse",
  customer: "Kevin Berger",
  open: false,
  ...o,
});

describe("weekGrid", () => {
  it("reads hours the way the office types them", () => {
    expect(parseHours("2:30")).toBe(150);
    expect(parseHours("2.5")).toBe(150);
    expect(parseHours("2")).toBe(120);
    expect(parseHours(".25")).toBe(15);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("2:75")).toBeNull();
    expect(parseHours("abc")).toBeNull();
    expect(fmtClock(150)).toBe("2:30");
  });

  it("moves the stop, never the start, and rolls past midnight", () => {
    expect(endAfter("2026-09-28", "23:00", 90)).toBe("2026-09-29T00:30");
    expect(originalEnd({ date: "2026-09-28", startTime: "22:00", endTime: "01:00" })).toBe(
      "2026-09-29T01:00",
    );
  });

  it("groups by job and day, and totals both ways", () => {
    const days = ["2026-09-28", "2026-09-29"];
    const g = buildGrid(
      [
        e({ id: "a" }),
        e({ id: "b", minutes: 30 }),
        e({ id: "c", date: "2026-09-29", jobId: "j2", jobName: "Main House" }),
        e({ id: "out", date: "2026-10-09" }),
      ],
      days,
    );
    expect(g.rows.map((r) => r.label)).toEqual(["Kevin Berger › Bunkhouse", "Kevin Berger › Main House"]);
    expect(g.rows[0].cells.get("2026-09-28")?.length).toBe(2);
    expect(g.rows[0].minutes).toBe(150);
    expect(g.dayMinutes.get("2026-09-29")).toBe(120);
    expect(g.total).toBe(270);
  });
});
