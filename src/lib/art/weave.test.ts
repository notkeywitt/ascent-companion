import { describe, expect, it } from "vitest";
import { buildWeave, hourLabel, splitHours, weaveStats, weaveTarget, WEAVE_HOURS } from "./weave";

const idx = (g: ReturnType<typeof buildWeave>, date: string, hour: number) =>
  g.dates.indexOf(date) * WEAVE_HOURS + (hour - 5);

describe("splitHours", () => {
  it("splits an entry across the two hours it covers", () => {
    const p = splitHours("2026-10-19T07:30:00", 1);
    expect(p.map((x) => x.hour)).toEqual([7, 8]);
    expect(p[0].hours).toBeCloseTo(0.5);
    expect(p[1].hours).toBeCloseTo(0.5);
  });
  it("keeps the pieces' sum equal to the entry", () => {
    const p = splitHours("2026-10-19T06:20:00", 8.4);
    expect(p.reduce((s, x) => s + x.hours, 0)).toBeCloseTo(8.4);
  });
  it("ignores a bad start or no hours", () => {
    expect(splitHours("nope", 2)).toEqual([]);
    expect(splitHours("2026-10-19T07:00:00", 0)).toEqual([]);
  });
});

describe("buildWeave", () => {
  const rows = [
    { start: "2026-10-19T07:30:00", hours: 1, person: "Ann" },
    { start: "2026-10-19T07:00:00", hours: 2, person: "Bo" },
    { start: "2026-10-21T13:00:00", hours: 4, person: "Ann" },
  ];
  const g = buildWeave(rows);

  it("spans first to last day and ranks people", () => {
    expect(g.days).toBe(3);
    expect(g.dates).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(g.people.map((p) => p.name)).toEqual(["Ann", "Bo"]);
  });
  it("puts split halves in the right cells", () => {
    expect(g.byPerson[0][idx(g, "2026-10-19", 7)]).toBeCloseTo(0.5);
    expect(g.byPerson[0][idx(g, "2026-10-19", 8)]).toBeCloseTo(0.5);
    expect(g.all[idx(g, "2026-10-19", 7)]).toBeCloseTo(1.5);
    expect(g.top[idx(g, "2026-10-19", 7)]).toBe(1);
  });
  it("totals equal the sum of hours", () => {
    expect(g.total).toBeCloseTo(7);
    expect(g.people.reduce((s, p) => s + p.total, 0)).toBeCloseTo(7);
    const per = g.byPerson.reduce((s, a) => s + a.reduce((x, y) => x + y, 0), 0);
    expect(per).toBeCloseTo(7);
  });
  it("scales the target to the biggest cell", () => {
    const t = weaveTarget(g, null, false);
    expect(Math.max(...t.v)).toBeCloseTo(1);
  });
  it("finds the busiest weekday and hour", () => {
    const s = weaveStats(g, null);
    expect(s.total).toBeCloseTo(7);
    expect(s.weekday).toBe(2); // Wednesday holds 4 h, Monday 3 h
  });
  it("labels hours", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(15)).toBe("3 PM");
  });
});
