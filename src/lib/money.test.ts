import { describe, expect, it } from "vitest";
import { money, money0 } from "./money";

describe("money", () => {
  it("formats en-US with two decimals", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(0)).toBe("$0.00");
  });
  it("puts the minus before the sign", () => {
    expect(money(-1234.5)).toBe("-$1,234.50");
    expect(money0(-1234.5)).toBe("-$1,235");
  });
  it("shows a missing amount as a dash, not a zero", () => {
    expect(money(undefined)).toBe("—");
    expect(money(null)).toBe("—");
    expect(money(NaN)).toBe("—");
    expect(money0(null)).toBe("—");
  });
  it("rounds to whole dollars", () => {
    expect(money0(1234.4)).toBe("$1,234");
  });
});
