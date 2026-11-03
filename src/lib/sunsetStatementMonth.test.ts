import { describe, expect, it } from "vitest";
import { isSunsetStatementBill } from "./jobtread";
import { approvalStatusFor, monthKeyLabel, statementBillPaid, statementMonthKey } from "./sunsetStatementMonth";

describe("statementMonthKey", () => {
  it("reads a day or a month", () => {
    expect(statementMonthKey("2026-10-31")).toBe("2026-10");
    expect(statementMonthKey("2026-10")).toBe("2026-10");
  });
  it("refuses junk", () => {
    expect(statementMonthKey("")).toBe("");
    expect(statementMonthKey("2026-13-01")).toBe("");
  });
  it("labels a key", () => {
    expect(monthKeyLabel("2026-10")).toBe("October 2026");
  });
});

describe("statementBillPaid", () => {
  it("is paid when money is applied and nothing is owed", () => {
    expect(statementBillPaid({ amountPaid: 731.01, balance: 0 })).toBe(true);
  });
  it("is not paid as a draft (0 / 0) or partly paid", () => {
    expect(statementBillPaid({ amountPaid: 0, balance: 0 })).toBe(false);
    expect(statementBillPaid({ amountPaid: 100, balance: 50 })).toBe(false);
  });
  it("is not paid when voided", () => {
    expect(statementBillPaid({ amountPaid: 10, balance: 0, status: "denied" })).toBe(false);
  });
});

describe("approvalStatusFor", () => {
  it("sends a Bill to pending and an Expense to approved", () => {
    expect(approvalStatusFor("Bill")).toBe("pending");
    expect(approvalStatusFor("Expense")).toBe("approved");
  });
});

describe("isSunsetStatementBill", () => {
  it("knows both ID formats", () => {
    expect(isSunsetStatementBill("STMT-5279e4f4")).toBe(true);
    expect(isSunsetStatementBill("11543_Oct2026")).toBe(true);
    expect(isSunsetStatementBill("11543_Oct2026_2")).toBe(true);
  });
  it("does not take an invoice number", () => {
    expect(isSunsetStatementBill("715451")).toBe(false);
    expect(isSunsetStatementBill("22PfZeNdFq6u")).toBe(false);
  });
});
