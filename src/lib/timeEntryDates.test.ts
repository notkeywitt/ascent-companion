import { describe, expect, it } from "vitest";
import {
  CUSTOM_RANGE,
  WEEK,
  addDays,
  rangeOfSelection,
  shortDay,
  weekStart,
} from "@/lib/timeEntryDates";

/**
 * The date arithmetic behind the shared Date filter.
 *
 * Worth pinning because every failure here is SILENT: a week that starts on the
 * wrong day, or a day that reads one off, just shows somebody the wrong hours —
 * there's no error, and the list looks perfectly plausible. It's also the code
 * that a "which week was that?" question is answered from at payroll time.
 *
 * Everything is UTC on purpose. The day strings arrive already converted to the
 * ORG's day (orgDay did that), so re-reading them in the viewer's zone would
 * shift each one back a day for anyone west of the org.
 */

describe("weekStart", () => {
  it("gives the MONDAY of the week a day falls in", () => {
    // 2026-08-12 is a Wednesday.
    expect(weekStart("2026-08-12")).toBe("2026-08-10");
    expect(weekStart("2026-08-10")).toBe("2026-08-10"); // Monday is its own start
  });

  it("puts Sunday at the END of its week, not the start of the next one", () => {
    // The off-by-one that would split a crew's week in half — Sunday steps back
    // six days, not zero. 2026-08-16 is a Sunday.
    expect(weekStart("2026-08-16")).toBe("2026-08-10");
    expect(weekStart("2026-08-17")).toBe("2026-08-17"); // the next Monday
  });

  it("crosses a month boundary rather than clamping inside it", () => {
    // 2026-09-02 is a Wednesday; its Monday is in August.
    expect(weekStart("2026-09-02")).toBe("2026-08-31");
  });

  it("hands back an unparseable day untouched instead of inventing one", () => {
    expect(weekStart("")).toBe("");
    expect(weekStart("not-a-day")).toBe("not-a-day");
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-08-10", 6)).toBe("2026-08-16");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("rangeOfSelection", () => {
  it("reads a week option back into the span it means", () => {
    expect(rangeOfSelection(`${WEEK}2026-08-10:2026-08-16`, "", "")).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
  });

  it("hands the from/to boxes back for a custom range, blanks included", () => {
    // Either end may be empty — "everything since" / "everything up to".
    expect(rangeOfSelection(CUSTOM_RANGE, "2026-08-01", "")).toEqual({
      from: "2026-08-01",
      to: "",
    });
  });

  it("is not a range for a single day or for no filter at all", () => {
    // Both are handled as an exact-day match by the caller, so answering with a
    // range here would silently widen the filter to everything.
    expect(rangeOfSelection("2026-08-12", "", "")).toBeNull();
    expect(rangeOfSelection("", "", "")).toBeNull();
  });
});

describe("shortDay", () => {
  it("reads the day as written rather than shifting it into the viewer's zone", () => {
    // The bug this guards: parsed as local time, this renders as Aug 11 for
    // anyone west of UTC — the entry appears on the wrong day.
    expect(shortDay("2026-08-12")).toMatch(/Aug 12/);
  });

  it("returns an unparseable value unchanged", () => {
    expect(shortDay("")).toBe("");
  });
});
