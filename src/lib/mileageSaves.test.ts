import { describe, expect, it } from "vitest";

import { SAVE_LOCK_MS, decideExisting, monthsFor } from "./mileageSaves";

const NOW = Date.parse("2026-11-14T18:00:00.000Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("decideExisting", () => {
  it("answers a saved key again", () => {
    expect(decideExisting({ state: "saved", result: "{}", updatedAt: at(1000) }, NOW)).toBe("saved");
  });
  it("waits on a save still in flight", () => {
    expect(decideExisting({ state: "saving", result: "", updatedAt: at(SAVE_LOCK_MS - 1000) }, NOW)).toBe("busy");
  });
  it("checks the sheet when a save went quiet or failed", () => {
    expect(decideExisting({ state: "saving", result: "", updatedAt: at(SAVE_LOCK_MS + 1000) }, NOW)).toBe("check");
    expect(decideExisting({ state: "failed", result: "", updatedAt: at(1000) }, NOW)).toBe("check");
  });
});

describe("monthsFor", () => {
  it("covers both months for a trip near a month end", () => {
    expect(monthsFor({ startTime: "2026-11-01T03:00:00.000Z" }).sort()).toEqual(["2026-10", "2026-11"]);
  });
  it("uses a hand-entered date", () => {
    expect(monthsFor({ date: "2026-09-12" })).toEqual(["2026-09"]);
  });
  it("falls back to this month", () => {
    expect(monthsFor({}, new Date(NOW))).toEqual(["2026-11"]);
  });
});
