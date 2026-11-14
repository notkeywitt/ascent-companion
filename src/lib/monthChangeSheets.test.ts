import { describe, expect, it } from "vitest";

import { closeDue, isLaterMonth, planCopy, prevMonth, recordsLabel } from "./monthChangeSheets";

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

describe("prevMonth", () => {
  it("steps back one month, across a year", () => {
    expect(prevMonth("2026-11")).toBe("2026-10");
    expect(prevMonth("2027-01")).toBe("2026-12");
    expect(prevMonth("nope")).toBe("");
  });
});

describe("recordsLabel", () => {
  it("names the block for the month after the billing month", () => {
    expect(recordsLabel("2026-06")).toBe("July '26");
    expect(recordsLabel("2026-10")).toBe("November '26");
    expect(recordsLabel("2026-12")).toBe("January '27");
  });
});

describe("closeDue", () => {
  it("asks for the month before Home while the sheets are still on it", () => {
    expect(closeDue("2026-11", "2026-10", false)).toBe("2026-10");
  });
  it("asks when the sheets sit on an older, stale month", () => {
    expect(closeDue("2026-11", "2026-07", false)).toBe("2026-10");
  });
  it("stops asking once month close is stamped", () => {
    expect(closeDue("2026-11", "2026-10", true)).toBe("");
  });
  it("does not ask when the sheets already moved past the month", () => {
    // Closed October, went back to October, forward to November again.
    expect(closeDue("2026-11", "2026-11", false)).toBe("");
    // Looking around in old months after the sheets moved on.
    expect(closeDue("2026-09", "2026-11", false)).toBe("");
  });
  it("does not ask on a guess", () => {
    expect(closeDue("2026-11", "", false)).toBe("");
    expect(closeDue("", "2026-10", false)).toBe("");
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
