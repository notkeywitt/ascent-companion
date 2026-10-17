import { describe, expect, it } from "vitest";
import { SWIPE_EDGE, SWIPE_THRESHOLD, swipeArmed, swipeStarts } from "./swipeBack";

describe("swipeStarts", () => {
  it("starts only at the left edge", () => {
    expect(swipeStarts(0)).toBe(true);
    expect(swipeStarts(SWIPE_EDGE)).toBe(true);
    expect(swipeStarts(SWIPE_EDGE + 1)).toBe(false);
  });
});

describe("swipeArmed", () => {
  it("arms at the threshold, not before", () => {
    expect(swipeArmed(SWIPE_THRESHOLD - 1, 0)).toBe(false);
    expect(swipeArmed(SWIPE_THRESHOLD, 0)).toBe(true);
  });

  it("ignores a leftward move", () => {
    expect(swipeArmed(-200, 0)).toBe(false);
  });

  it("ignores a mostly vertical move", () => {
    expect(swipeArmed(100, 60)).toBe(false);
    expect(swipeArmed(100, -60)).toBe(false);
    expect(swipeArmed(100, 40)).toBe(true);
  });
});
