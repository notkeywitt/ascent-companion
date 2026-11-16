import { describe, expect, it } from "vitest";
import { buildPayables, type PayableInput } from "./accountsPayable";

const bill = (o: Partial<PayableInput>): PayableInput => ({
  id: "1",
  vendor: "Island Lumber",
  cost: 100,
  issueDate: "2026-10-31",
  status: "approved",
  amountPaid: 0,
  balance: 100,
  isExpense: false,
  jobId: "j",
  jobName: "Job",
  customerName: "Client",
  ...o,
});

describe("buildPayables", () => {
  it("leaves out Sunset bills and Expenses, and counts each", () => {
    const s = buildPayables([
      bill({ id: "a" }),
      bill({ id: "b", vendor: "Sunset Builders Supply" }),
      bill({ id: "c", isExpense: true }),
    ]);
    expect(s.bills.map((b) => b.id)).toEqual(["a"]);
    expect(s.sunsetLeftOut).toBe(1);
    expect(s.expensesLeftOut).toBe(1);
  });

  it("marks paid, part-paid and unpaid, and sorts unpaid first", () => {
    const s = buildPayables([
      bill({ id: "paid", vendor: "A", amountPaid: 100, balance: 0 }),
      bill({ id: "part", vendor: "B", amountPaid: 40, balance: 60 }),
      bill({ id: "none", vendor: "C" }),
    ]);
    expect(s.bills.map((b) => [b.id, b.paid, b.owed])).toEqual([
      ["none", "unpaid", 100],
      ["part", "partial", 60],
      ["paid", "paid", 0],
    ]);
    expect(s.owed).toBe(160);
    expect(s.total).toBe(300);
    expect(s.paidCount).toBe(1);
    expect(s.unpaidCount).toBe(2);
  });

  it("counts a draft (balance 0, nothing paid) as owed in full", () => {
    const s = buildPayables([bill({ status: "draft", balance: 0 })]);
    expect(s.bills[0].paid).toBe("unpaid");
    expect(s.owed).toBe(100);
  });
});
