import { describe, expect, it } from "vitest";
import { cloudRecords, divisionOf } from "./rows";

describe("divisionOf", () => {
  it("takes the first two digits of a cost code", () => {
    expect(divisionOf("06 10 00")).toBe("06");
    expect(divisionOf("")).toBe("none");
  });
});

describe("cloudRecords", () => {
  it("reads a time entry's start hour and weekday from its org-local start", () => {
    const [r] = cloudRecords("labor", [
      { start: "2026-11-16T07:30:00", hours: 8, person: "A", job: "J", code: "06 10 00", pay: "Regular Pay" },
    ]);
    expect(r.num.start).toBe(7.5);
    // 2026-11-16 is a Monday (day 1).
    expect(r.num.dowSin).toBeCloseTo(Math.sin((2 * Math.PI) / 7));
    expect(r.cat.div).toBe("06");
  });
});
