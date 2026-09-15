import { describe, expect, it } from "vitest";

import {
  PROBLEM_FIX,
  PROBLEM_LABEL,
  PROBLEM_ORDER,
  PROBLEM_RETRYABLE,
  clockOf,
  driftMinutes,
  isErrorStatus,
  sheetProblem,
  wallClock,
} from "./timeProblems";

/**
 * The two judgment calls behind Time Sync, and the stamp parsing both sides of
 * the system depend on. Everything else in the feature is I/O.
 *
 * The one that matters most is `sheetProblem`'s ORDER. A record with no
 * JobTread id can be re-posted; a record that HAS one must never be, because
 * re-posting it puts a second entry in someone's payroll. The two states are
 * told apart by nothing but the id column, so they are tested by it.
 */

const row = (jtEntryId: string, jtStatus: string) => sheetProblem(jtEntryId, jtStatus);

describe("sheetProblem — what the Time Entries row says about itself", () => {
  it("calls a row with a JobTread id and a clean status fine", () => {
    expect(row("22_abc", "pushed")).toBeNull();
    expect(row("22_abc", "pushed (retry)")).toBeNull();
    expect(row("22_abc", "adopted (already in JobTread)")).toBeNull();
  });

  it("calls a row with no JobTread id not-posted, whatever its status says", () => {
    expect(row("", "pending push")).toBe("not-posted");
    expect(row("", "not pushed (writes off)")).toBe("not-posted");
    expect(row("", "")).toBe("not-posted");
    // The one-shot log path records the refusal AND leaves the id empty, so
    // this is still the retryable state — nothing was created to duplicate.
    expect(row("", "JobTread error: cost type is not able to be time tracked")).toBe("not-posted");
  });

  it("calls a row that HAS an id and an error status push-failed, never not-posted", () => {
    // The refused clock-out. Retrying this would create a second entry beside
    // the one JobTread already has open.
    expect(row("22_abc", "JobTread error: something went wrong")).toBe("push-failed");
    expect(PROBLEM_RETRYABLE["push-failed"]).toBe(false);
    expect(PROBLEM_RETRYABLE["not-posted"]).toBe(true);
  });

  it("treats whitespace as absence", () => {
    expect(row("   ", "pushed")).toBe("not-posted");
  });

  it("matches the error status the push paths actually write", () => {
    expect(isErrorStatus("JobTread error: 400 Bad Request")).toBe(true);
    expect(isErrorStatus("  jobtread error: lowercase  ")).toBe(true);
    expect(isErrorStatus("pushed")).toBe(false);
    // "pushed, sheet not updated" is a WARNING the retry returns, not a status
    // the sheet ever holds — and it must not read as a refusal.
    expect(isErrorStatus("pushed, sheet not updated")).toBe(false);
  });
});

describe("wall clocks — the sheet and the app write the same minute two ways", () => {
  it("reads the sheet's space-separated stamp and the app's ISO one alike", () => {
    // _tetWallClock (EmployeeTime.js) writes the first; jtIsoToOrgLocal the second.
    expect(wallClock("2026-09-14 07:30")).toMatchObject({ date: "2026-09-14", hhmm: "07:30" });
    expect(wallClock("2026-09-14T07:30:00")).toMatchObject({ date: "2026-09-14", hhmm: "07:30" });
    expect(wallClock("2026-09-14 07:30")?.ms).toBe(wallClock("2026-09-14T07:30:00")?.ms);
  });

  it("refuses anything that isn't a date and a time", () => {
    expect(wallClock("")).toBeNull();
    expect(wallClock("yesterday")).toBeNull();
    expect(wallClock("2026-09-14")).toBeNull();
    expect(clockOf("nonsense")).toBe("");
  });

  it("measures drift across the two shapes, which is the whole point", () => {
    // The sheet keeps minutes; JobTread keeps seconds. Under the 2-minute
    // tolerance, so this pair is a MATCH, not a mismatch.
    expect(driftMinutes("2026-09-14 07:30", "2026-09-14T07:30:42")).toBeCloseTo(0.7, 1);
    expect(driftMinutes("2026-09-14 07:30", "2026-09-14T09:30:00")).toBe(120);
    // The 7-hour timezone bug's signature, back when the app sent a bare wall
    // clock and JobTread read it as UTC.
    expect(driftMinutes("2026-09-14 07:30", "2026-09-14T00:30:00")).toBe(420);
  });

  it("reports NaN rather than 0 when a stamp can't be read", () => {
    // 0 would read as "they agree" and silently pass the tolerance check.
    expect(driftMinutes("", "2026-09-14T07:30:00")).toBeNaN();
    expect(Number.isFinite(driftMinutes("2026-09-14 07:30", ""))).toBe(false);
  });
});

describe("the problem table", () => {
  it("gives every problem an order, a heading and a fix", () => {
    for (const p of PROBLEM_ORDER) {
      expect(PROBLEM_LABEL[p], `no label for ${p}`).toBeTruthy();
      expect(PROBLEM_FIX[p], `no fix for ${p}`).toBeTruthy();
      expect(typeof PROBLEM_RETRYABLE[p]).toBe("boolean");
    }
    expect(new Set(PROBLEM_ORDER).size).toBe(PROBLEM_ORDER.length);
  });

  it("offers a retry for exactly one problem — the only one a re-post fixes", () => {
    expect(PROBLEM_ORDER.filter((p) => PROBLEM_RETRYABLE[p])).toEqual(["not-posted"]);
  });
});
