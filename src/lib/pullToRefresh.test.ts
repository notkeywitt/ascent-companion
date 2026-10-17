import { describe, expect, it } from "vitest";
import { PULL_MAX, PULL_THRESHOLD, pullArmed, pullDistance } from "./pullToRefresh";

describe("pullDistance", () => {
  it("is zero for an upward or zero move", () => {
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(0)).toBe(0);
  });

  it("moves at half the finger's rate", () => {
    expect(pullDistance(60)).toBe(30);
  });

  it("caps at PULL_MAX", () => {
    expect(pullDistance(10_000)).toBe(PULL_MAX);
  });
});

describe("pullArmed", () => {
  it("arms at the threshold, not before", () => {
    expect(pullArmed(PULL_THRESHOLD - 1)).toBe(false);
    expect(pullArmed(PULL_THRESHOLD)).toBe(true);
  });

  it("is reachable inside the cap", () => {
    expect(pullArmed(pullDistance(PULL_THRESHOLD * 2))).toBe(true);
  });
});
