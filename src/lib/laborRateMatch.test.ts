import { describe, expect, it } from "vitest";

import { findMismatches, rateChanges, unmappedPairs, type RateEntry } from "./laborRateMatch";

describe("labor rates map", () => {
  it("assigns the employee's pay type at the map rate, and flags a missing one", () => {
    const row = (id: string, userId: string, code: string, hourlyRate: number) => ({ id, userId, jobId: "j", code, hourlyRate });
    const members = [
      { userId: "a", types: [{ name: "Regular", hourlyRate: 40 }, { name: "Lead", hourlyRate: 60 }] },
      { userId: "b", types: [{ name: "Regular", hourlyRate: 40 }] },
    ];
    const out = rateChanges(
      [row("1", "a", "06", 40), row("2", "b", "06", 40), row("3", "a", "06", 60), row("4", "a", "99", 40)],
      [{ jobId: "j", costCode: "06", hourlyRate: 60 }],
      members,
    );
    expect([...out]).toEqual([
      ["1", { rate: 60, type: "Lead" }],
      ["2", { rate: 60, type: null }],
    ]);
  });
});

const e = (id: string, jobId: string, code: string, type: string): RateEntry => ({
  id,
  date: "2026-11-02",
  employee: "Cedar",
  userId: "u1",
  jobId,
  jobName: jobId,
  code,
  type,
  hours: 1,
});
const map = [{ jobId: "ferron", jobName: "Ferron", costCode: "26 50 00", payType: "Ferron - Lead" }];

describe("labor rate map", () => {
  it("flags an entry whose type differs from the map, on that job and code only", () => {
    const rows = [
      e("1", "ferron", "26 50 00", "Ferron - Regular Pay"),
      e("2", "ferron", "26 50 00", "Ferron - Lead"),
      e("3", "ferron", "06 10 00", "Ferron - Regular Pay"),
      e("4", "other", "26 50 00", "Regular Pay"),
    ];
    const bad = findMismatches(rows, map);
    expect(bad.map((m) => m.entry.id)).toEqual(["1"]);
    expect(bad[0].expected).toBe("Ferron - Lead");
  });

  it("lists unmapped pairs with their types, most used first", () => {
    const rows = [
      e("1", "ferron", "06 10 00", "A"),
      e("2", "ferron", "06 10 00", "B"),
      e("3", "ferron", "06 10 00", "B"),
      e("4", "ferron", "26 50 00", "A"),
    ];
    const pairs = unmappedPairs(rows, map);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].types).toEqual([
      { payType: "B", count: 2 },
      { payType: "A", count: 1 },
    ]);
  });
});
