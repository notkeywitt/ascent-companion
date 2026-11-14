import { describe, expect, it } from "vitest";

import { isLaterMonth, planCopy, recordsLabel, sheetsHoldAnotherMonth, syncIsRunning } from "./monthChangeSheets";

describe("isLaterMonth", () => {
  it("is true only for a move forward", () => {
    expect(isLaterMonth("2026-10", "2026-11")).toBe(true);
    expect(isLaterMonth("2026-12", "2027-01")).toBe(true);
    expect(isLaterMonth("2026-11", "2026-11")).toBe(false);
    expect(isLaterMonth("2026-11", "2026-10")).toBe(false);
  });
  it("is false for anything that is not a month", () => {
    expect(isLaterMonth("", "2026-11")).toBe(false);
    expect(isLaterMonth("2026-10", "")).toBe(false);
  });
});

describe("recordsLabel", () => {
  it("names the block for the month after the billing month", () => {
    expect(recordsLabel("2026-06")).toBe("July '26");
    expect(recordsLabel("2026-10")).toBe("November '26");
    expect(recordsLabel("2026-12")).toBe("January '27");
  });
});

describe("sheetsHoldAnotherMonth", () => {
  const running = { triggerInstalled: true, paused: false };
  const paused = { triggerInstalled: true, paused: true };
  it("blocks the copy when a running sync holds another month", () => {
    expect(sheetsHoldAnotherMonth(running, "2026-07", "2026-10")).toBe(true);
  });
  it("allows the copy when the running sync holds the closing month", () => {
    expect(sheetsHoldAnotherMonth(running, "2026-10", "2026-10")).toBe(false);
  });
  it("allows the copy while the sync is paused or not installed", () => {
    expect(sheetsHoldAnotherMonth(paused, "2026-07", "2026-10")).toBe(false);
    expect(sheetsHoldAnotherMonth({ triggerInstalled: false }, "2026-07", "2026-10")).toBe(false);
    expect(sheetsHoldAnotherMonth(null, "2026-07", "2026-10")).toBe(false);
    expect(syncIsRunning(paused)).toBe(false);
  });
});

describe("planCopy", () => {
  it("keeps a block that already holds the month's figures", () => {
    expect(planCopy({ mode: "overwrote-existing-month-block", overwroteValues: true })).toBe("keep");
  });
  it("copies into a free block, or a labelled block that is empty", () => {
    expect(planCopy({ mode: "new-block", overwroteValues: false })).toBe("copy");
    expect(planCopy({ mode: "overwrote-existing-month-block", overwroteValues: false })).toBe("copy");
  });
});
