import { describe, expect, it } from "vitest";
import { monthsTouched, periodLabel, periodOf, stepAnchor } from "./laborPeriod";

describe("laborPeriod", () => {
  it("weeks run Monday to Sunday", () => {
    // 2026-11-14 is a Saturday.
    expect(periodOf("week", "2026-11-14")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(periodOf("week", "2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(periodOf("week", "2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  it("halves split on the 15th and end on the month's last day", () => {
    expect(periodOf("half", "2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-15" });
    expect(periodOf("half", "2026-02-16")).toEqual({ from: "2026-02-16", to: "2026-02-28" });
    expect(periodOf("month", "2028-02-03")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("steps across months and years", () => {
    expect(stepAnchor("half", "2026-12-20", 1)).toBe("2027-01-01");
    expect(stepAnchor("half", "2026-12-03", -1)).toBe("2026-11-30");
    expect(stepAnchor("month", "2026-01-10", -1)).toBe("2025-12-31");
    expect(stepAnchor("week", "2026-11-14", 1)).toBe("2026-11-16");
  });

  it("lists every month a range touches", () => {
    expect(monthsTouched("2026-12-28", "2027-01-04")).toEqual([
      [2026, 12],
      [2027, 1],
    ]);
    expect(monthsTouched("2026-11-01", "2026-11-15")).toEqual([[2026, 11]]);
  });

  it("labels each kind", () => {
    expect(periodLabel("month", "2026-11-01", "2026-11-30")).toBe("November 2026");
    expect(periodLabel("half", "2026-11-01", "2026-11-15")).toBe("Nov 1 – 15, 2026");
    expect(periodLabel("week", "2026-11-30", "2026-12-06")).toBe("Nov 30 – Dec 6, 2026");
  });
});
