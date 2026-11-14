import { describe, expect, it } from "vitest";
import { splitClocks, splitMinutes } from "./splitTime";

describe("splitMinutes", () => {
  it("halves always sum to the original", () => {
    for (const first of [1, 30, 239, 479]) {
      const r = splitMinutes(480, first)!;
      expect(r.first + r.second).toBe(480);
    }
  });
  it("refuses an empty or oversize half", () => {
    expect(splitMinutes(480, 0)).toBeNull();
    expect(splitMinutes(480, 480)).toBeNull();
    expect(splitMinutes(480, 2.5)).toBeNull();
  });
});

describe("splitClocks", () => {
  it("meets in the middle", () => {
    const r = splitClocks("07:00", "15:00", 240)!;
    expect(r.a).toEqual({ start: "07:00", end: "11:00" });
    expect(r.b).toEqual({ start: "11:00", end: "15:00", dayOffset: 0 });
  });
  it("handles an overnight shift", () => {
    const r = splitClocks("22:00", "06:00", 180)!;
    expect(r.b).toEqual({ start: "01:00", end: "06:00", dayOffset: 1 });
    expect(r.first + r.second).toBe(480);
  });
});
