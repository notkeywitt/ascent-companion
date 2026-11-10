import { describe, expect, it } from "vitest";

import {
  buildCardRows,
  buildGrid,
  endAfter,
  entrySpan,
  fmtClock,
  hourRange,
  originalEnd,
  parseHours,
  placeBlocks,
  stackStart,
} from "./weekGrid";

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

  it("adds ghost rows only for jobs with no row yet", () => {
    const g = buildGrid([e({})], ["2026-09-28"], [
      { key: "j1", label: "dup" },
      { key: "j9", label: "Moon Spring Farm LLC › Pole Barn" },
    ]);
    expect(g.rows.map((r) => [r.label, !!r.ghost])).toEqual([
      ["Kevin Berger › Bunkhouse", false],
      ["Moon Spring Farm LLC › Pole Barn", true],
    ]);
  });
});

describe("time card", () => {
  const ce = (o: Partial<Parameters<typeof buildCardRows>[0][number]>) => ({
    ...e({}),
    costItemId: "c1",
    costCode: "01 00 00",
    costItemName: "General",
    ...o,
  });

  it("gives each job + cost code its own row", () => {
    const rows = buildCardRows(
      [ce({ id: "a" }), ce({ id: "b", costItemId: "c2", costCode: "02 00 00" }), ce({ id: "c", date: "2026-09-29" })],
      ["2026-09-28", "2026-09-29"],
    );
    expect(rows.map((r) => r.key)).toEqual(["j1|c1", "j1|c2"]);
    expect(rows[0].cells.get("2026-09-29")?.map((x) => x.id)).toEqual(["c"]);
    expect(rows[0].work).toBe("01 00 00 — General");
  });

  it("starts a new entry after the day's last stop", () => {
    const existing = [e({ startTime: "07:00", endTime: "11:30" }), e({ date: "2026-09-29", endTime: "18:00" })];
    expect(stackStart("2026-09-28", 60, existing, [])).toBe("11:30");
    expect(stackStart("2026-09-30", 60, existing, [])).toBe("07:00");
  });

  it("stacks two new entries on one day", () => {
    expect(stackStart("2026-09-30", 60, [], [{ date: "2026-09-30", start: "07:00", minutes: 150 }])).toBe("09:30");
  });

  it("refuses hours that would run past midnight", () => {
    expect(stackStart("2026-09-28", 120, [e({ startTime: "20:00", endTime: "23:00" })], [])).toBe("");
    expect(stackStart("2026-09-28", 18 * 60, [], [])).toBe("");
  });

  it("does not stack on an open entry", () => {
    expect(stackStart("2026-09-28", 60, [e({ endTime: "", open: true })], [])).toBe("07:00");
  });
});

describe("calendar layout", () => {
  it("reads a span in minutes and clamps a stop past midnight", () => {
    expect(entrySpan({ startTime: "08:00", endTime: "10:30", minutes: 150 })).toEqual({ start: 480, end: 630 });
    expect(entrySpan({ startTime: "22:00", endTime: "01:00", minutes: 180 })).toEqual({ start: 1320, end: 1440 });
    expect(entrySpan({ startTime: "09:00", endTime: "", minutes: 10 })).toEqual({ start: 540, end: 570 });
  });

  it("puts overlapping entries side by side and lone ones full width", () => {
    const b = placeBlocks([
      e({ id: "a", startTime: "08:00", endTime: "10:00" }),
      e({ id: "b", startTime: "09:00", endTime: "11:00" }),
      e({ id: "c", startTime: "12:00", endTime: "13:00" }),
    ]);
    const by = Object.fromEntries(b.map((x) => [x.e.id, x]));
    expect([by.a.col, by.a.cols]).toEqual([0, 2]);
    expect([by.b.col, by.b.cols]).toEqual([1, 2]);
    expect([by.c.col, by.c.cols]).toEqual([0, 1]);
  });

  it("widens the hour range to fit early and late entries", () => {
    expect(hourRange([])).toEqual({ from: 6, to: 18 });
    expect(hourRange([{ start: 330, end: 1170 }])).toEqual({ from: 5, to: 20 });
  });
});
