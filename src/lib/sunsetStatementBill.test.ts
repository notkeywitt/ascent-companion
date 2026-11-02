import { describe, expect, it } from "vitest";
import { statementBillLines, statementIssueDate } from "./sunsetStatementBill";

const stmt = {
  expId: "STMT-1a2b3c4d",
  project: "Smith - Remodel",
  statementDate: "2026-10-31",
  statementNumber: "123456",
  total: "1000.00",
  discount: "20.00",
};

describe("statementIssueDate", () => {
  it("keeps a full date", () => {
    expect(statementIssueDate("2026-10-31")).toBe("2026-10-31");
  });
  it("takes the last day of a month-only date", () => {
    expect(statementIssueDate("2026-09")).toBe("2026-09-30");
    expect(statementIssueDate("2028-2")).toBe("2028-02-29");
  });
  it("refuses a missing or odd date", () => {
    expect(statementIssueDate("")).toBe("");
    expect(statementIssueDate("2026")).toBe("");
    expect(statementIssueDate("2026-13")).toBe("");
  });
});

describe("statementBillLines", () => {
  it("bills the total and the discount as a negative line, both coded", () => {
    const r = statementBillLines(stmt, "leaf1", "88 70 00");
    if ("error" in r) throw new Error(r.error);
    expect(r.net).toBe(980);
    expect(r.lines.map((l) => l.unitCost)).toEqual([1000, -20]);
    expect(r.lines.every((l) => l.jobCostItemId === "leaf1" && l.costCode === "88 70 00")).toBe(true);
    expect(r.lines[0].name).toBe("Sunset statement 123456 — Smith - Remodel");
  });
  it("leaves out a zero or blank discount", () => {
    for (const discount of ["0", ""]) {
      const r = statementBillLines({ ...stmt, discount }, "leaf1", "88 70 00");
      if ("error" in r) throw new Error(r.error);
      expect(r.lines).toHaveLength(1);
      expect(r.net).toBe(1000);
    }
  });
  it("refuses a statement it would bill wrong", () => {
    expect(statementBillLines({ ...stmt, total: "" }, "l", "c")).toEqual({ error: "the statement total is missing" });
    expect(statementBillLines({ ...stmt, discount: "abc" }, "l", "c")).toEqual({
      error: "the prompt discount did not read",
    });
    expect(statementBillLines({ ...stmt, discount: "1000" }, "l", "c")).toEqual({
      error: "the discount is not below the total",
    });
  });
});
