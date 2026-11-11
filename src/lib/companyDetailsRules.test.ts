import { describe, expect, it } from "vitest";

import {
  cleanDetailsInput,
  docProblem,
  percentTextToRate,
  rateLabel,
  rateToPercentText,
} from "./companyDetailsRules";

describe("rates", () => {
  it("shows a stored decimal as a percent", () => {
    expect(rateToPercentText("0.0835")).toBe("8.35");
    expect(rateToPercentText("0.18")).toBe("18");
    expect(rateLabel("0.0835")).toBe("8.35%");
    expect(rateLabel("")).toBe("");
  });
  it("stores a typed percent as a decimal", () => {
    expect(percentTextToRate("8.35")).toBe("0.0835");
    expect(percentTextToRate("18%")).toBe("0.18");
    expect(percentTextToRate("")).toBe("");
  });
  it("refuses what is not a percent", () => {
    expect(percentTextToRate("abc")).toBeNull();
    expect(percentTextToRate("-3")).toBeNull();
    expect(percentTextToRate("101")).toBeNull();
  });
});

describe("cleanDetailsInput", () => {
  it("cleans known keys and ignores the rest", () => {
    const r = cleanDetailsInput({ tax: "8.35", ubi: " 602737647 ", nope: "x" });
    expect(r.error).toBeUndefined();
    expect(r.values).toEqual({ tax: "0.0835", ubi: "602737647" });
  });
  it("reports a bad rate", () => {
    expect(cleanDetailsInput({ po: "lots" }).error).toMatch(/P&O/);
  });
  it("refuses a non-object", () => {
    expect(cleanDetailsInput(null).error).toBeTruthy();
  });
});

describe("docProblem", () => {
  it("accepts a small PDF", () => {
    expect(docProblem({ size: 1000, type: "application/pdf" })).toBeNull();
  });
  it("refuses big, empty and odd files", () => {
    expect(docProblem({ size: 5 * 1024 * 1024, type: "application/pdf" })).toMatch(/4 MB/);
    expect(docProblem({ size: 0, type: "application/pdf" })).toMatch(/empty/);
    expect(docProblem({ size: 10, type: "text/html" })).toMatch(/PDF/);
  });
});
