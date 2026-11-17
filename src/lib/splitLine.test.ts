import { describe, expect, it } from "vitest";
import { splitCents, toCents } from "./splitLine";

describe("splitCents", () => {
  it("keeps the two shares equal to the total", () => {
    expect(splitCents(1001, 500)).toEqual({ first: 500, second: 501 });
  });
  it("refuses an empty or full share", () => {
    expect(splitCents(1000, 0)).toBeNull();
    expect(splitCents(1000, 1000)).toBeNull();
    expect(splitCents(1000, -5)).toBeNull();
  });
  it("refuses non-integer cents", () => {
    expect(splitCents(1000, 10.5)).toBeNull();
  });
});

describe("toCents", () => {
  it("rounds dollars to cents", () => {
    expect(toCents("12.345")).toBe(1235);
    expect(toCents("0.1")).toBe(10);
  });
  it("returns NaN for text", () => {
    expect(toCents("abc")).toBeNaN();
  });
});
