import { describe, expect, it } from "vitest";

import { blockingClock, type OpenClock } from "./employeeClock";

/**
 * THE CLOCK-IN GUARD. JobTread allows one running clock per person and closes
 * the old one, silently, when a new one opens. A clock-in from a stale screen
 * therefore cut real shifts short and stacked an overlapping entry on top —
 * 13h38m on one crew member's 2026-10-05. The route refuses whenever this
 * returns a clock.
 */

function clock(entryId: string, startedAt = "2026-10-05T07:57:41"): OpenClock {
  return {
    entryId,
    startedAt,
    jobId: "job",
    jobLabel: "Customer - Job",
    costItemId: "ci",
    costCode: "06 15 00",
    costItemName: "Wood Decking",
    payType: "Regular Pay",
    employee: "Crew Member",
  };
}

describe("blockingClock", () => {
  it("lets a clock-in through when nothing is running", () => {
    expect(blockingClock([], [])).toBeNull();
  });

  it("blocks a clock-in while JobTread holds a running clock", () => {
    const running = clock("A");
    expect(blockingClock([running], [])).toBe(running);
  });

  it("lets JobTread close a clock this device just clocked out", () => {
    // The clock-out is detached: its JobTread update can land after the next
    // clock-in, and then writes the real end time over JobTread's close.
    expect(blockingClock([clock("A")], ["A"])).toBeNull();
  });

  it("still blocks a running clock the device did not clock out", () => {
    const other = clock("B", "2026-10-05T12:38:43");
    expect(blockingClock([other, clock("A")], ["A"])).toBe(other);
  });
});
