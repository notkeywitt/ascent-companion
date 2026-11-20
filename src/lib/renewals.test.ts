import { describe, expect, it } from "vitest";
import { attentionCount, cleanRenewals, renewalStatus, rollYear, sortRenewals } from "./renewals";

const r = (due: string, warnDays = 30) => ({ id: due, name: due, due, warnDays, notes: "", link: "" });

describe("renewals", () => {
  it("classifies by warn window", () => {
    expect(renewalStatus(r(""), "2026-11-20")).toBe("none");
    expect(renewalStatus(r("2026-11-19"), "2026-11-20")).toBe("overdue");
    expect(renewalStatus(r("2026-11-20"), "2026-11-20")).toBe("soon");
    expect(renewalStatus(r("2026-12-20"), "2026-11-20")).toBe("soon");
    expect(renewalStatus(r("2026-12-21"), "2026-11-20")).toBe("ok");
  });
  it("rolls a year", () => {
    expect(rollYear("2026-11-20")).toBe("2027-11-20");
    expect(rollYear("2028-02-29")).toBe("2029-02-28");
  });
  it("sorts undated last and counts attention", () => {
    const l = [r(""), r("2027-01-01"), r("2026-11-01")];
    expect(sortRenewals(l).map((x) => x.due)).toEqual(["2026-11-01", "2027-01-01", ""]);
    expect(attentionCount(l, "2026-11-20")).toBe(1);
  });
  it("cleans input", () => {
    expect(cleanRenewals("x")).toBeNull();
    expect(cleanRenewals([{ name: " A ", due: "bad", warnDays: -1 }])).toEqual([
      { id: "r-0", name: "A", due: "", warnDays: 30, notes: "", link: "" },
    ]);
  });
});
