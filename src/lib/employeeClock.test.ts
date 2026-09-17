import { describe, expect, it } from "vitest";
import { minusMinutes, paidMinutes } from "./employeeClock";

describe("break arithmetic", () => {
  it("deducts the break from the paid minutes", () => {
    expect(paidMinutes("2026-09-16T14:00:00.000Z", "2026-09-16T22:00:00.000Z", 30)).toBe(450);
  });

  it("never pays negative time when the break swallows the shift", () => {
    expect(paidMinutes("2026-09-16T14:00:00.000Z", "2026-09-16T14:20:00.000Z", 30)).toBe(0);
  });

  it("ignores a missing or nonsense break", () => {
    expect(paidMinutes("2026-09-16T14:00:00.000Z", "2026-09-16T15:00:00.000Z", 0)).toBe(60);
    expect(paidMinutes("2026-09-16T14:00:00.000Z", "2026-09-16T15:00:00.000Z", -5)).toBe(60);
  });

  it("moves a stop time back by the break", () => {
    expect(minusMinutes("2026-09-16T22:00:00.000Z", 30)).toBe("2026-09-16T21:30:00.000Z");
  });
});
