import { describe, expect, it } from "vitest";

import { findMismatches, unmappedPairs, type RateEntry } from "./laborRateMatch";

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
