import { describe, expect, it } from "vitest";

import { scanEvery } from "./scanCountdown";

describe("scanEvery", () => {
  const at = "2026-11-14T10:00:00Z";
  const t = (min: number) => Date.parse(at) + min * 60_000;

  it("counts down to the last run plus 15 minutes", () => {
    expect(scanEvery(at, t(6))).toBe("every 15 min, next in ~9 min");
    expect(scanEvery(at, t(14.5))).toBe("every 15 min, next in ~1 min");
  });

  it("says any minute once the time passes", () => {
    expect(scanEvery(at, t(15))).toBe("every 15 min, next any minute");
    expect(scanEvery(at, t(40))).toBe("every 15 min, next any minute");
  });

  it("keeps the plain interval without a stamp", () => {
    expect(scanEvery(null, t(0))).toBe("every 15 min");
    expect(scanEvery(undefined, t(0))).toBe("every 15 min");
  });
});
