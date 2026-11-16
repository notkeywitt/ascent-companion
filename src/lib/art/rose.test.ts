import { describe, expect, it } from "vitest";
import { bucketOf, buildRose, overlaySeries, ROSE_BUCKETS } from "./rose";
import { weekdayOf } from "./weave";

describe("buildRose", () => {
  it("knows 2026-11-15 is a Sunday", () => {
    expect(weekdayOf(Math.floor(Date.UTC(2026, 10, 15) / 86_400_000))).toBe(6);
  });
  it("puts a Sunday 23:30 entry in bucket 6*24+23", () => {
    const r = buildRose([{ start: "2026-11-15T23:30:00", hours: 0.5, person: "Ann" }]);
    expect(r.all[6 * 24 + 23]).toBeCloseTo(0.5);
    expect(r.total).toBeCloseTo(0.5);
  });
  it("splits an entry across two hours, and across Sunday into Monday", () => {
    const r = buildRose([{ start: "2026-11-15T23:30:00", hours: 1, person: "Ann" }]);
    expect(r.all[bucketOf(6, 23)]).toBeCloseTo(0.5);
    expect(r.all[bucketOf(0, 0)]).toBeCloseTo(0.5);
  });
  it("totals equal the sum of hours", () => {
    const rows = [
      { start: "2026-11-16T07:15:00", hours: 8.25, person: "Ann" },
      { start: "2026-11-17T06:00:00", hours: 9, person: "Bo" },
      { start: "2026-11-23T07:00:00", hours: 8, person: "Ann" },
    ];
    const r = buildRose(rows);
    const sum = rows.reduce((s, x) => s + x.hours, 0);
    expect(r.total).toBeCloseTo(sum);
    expect(r.all.length).toBe(ROSE_BUCKETS);
    expect(r.byPerson.reduce((s, a) => s + a.reduce((x, y) => x + y, 0), 0)).toBeCloseTo(sum);
    expect(r.people[0].name).toBe("Ann");
  });
  it("folds people past the eighth into Others", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      start: "2026-11-16T07:00:00",
      hours: 10 - i,
      person: `P${i}`,
    }));
    const s = overlaySeries(buildRose(rows));
    expect(s).toHaveLength(9);
    expect(s[8].name).toBe("Others");
    expect(s[8].total).toBeCloseTo(2 + 1);
  });
});
