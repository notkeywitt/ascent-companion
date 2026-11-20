import { describe, expect, it } from "vitest";
import { buildUnpaidBills, type UnpaidBillInput } from "./unpaidBills";

const bill = (o: Partial<UnpaidBillInput>): UnpaidBillInput => ({
  id: "1",
  vendor: "Island Lumber",
  cost: 100,
  issueDate: "2026-11-05",
  createdAt: "2026-11-05T10:00:00Z",
  status: "approved",
  amountPaid: 0,
  balance: 100,
  isExpense: false,
  jobName: "Job",
  customerName: "Client",
  ...o,
});

describe("buildUnpaidBills", () => {
  it("leaves out bills dated before November", () => {
    const r = buildUnpaidBills([
      bill({ id: "oct", issueDate: "2026-10-31", isExpense: true }),
      bill({ id: "nov", issueDate: "2026-11-01" }),
    ]);
    expect(r.bills.map((b) => b.id)).toEqual(["nov"]);
  });

  it("leaves out paid and voided bills, keeps part paid and drafts", () => {
    const r = buildUnpaidBills([
      bill({ id: "paid", amountPaid: 100, balance: 0 }),
      bill({ id: "void", status: "denied" }),
      bill({ id: "part", amountPaid: 40, balance: 60 }),
      bill({ id: "draft", status: "draft", balance: 0 }),
    ]);
    expect(r.bills.map((b) => b.id).sort()).toEqual(["draft", "part"]);
    expect(r.bills.find((b) => b.id === "part")!.owed).toBe(60);
    expect(r.owed).toBe(160);
  });

  it("sorts newest to oldest", () => {
    const r = buildUnpaidBills([
      bill({ id: "a", issueDate: "2026-11-02" }),
      bill({ id: "c", issueDate: "2026-11-18", createdAt: "2026-11-18T09:00:00Z" }),
      bill({ id: "d", issueDate: "2026-11-18", createdAt: "2026-11-19T09:00:00Z" }),
      bill({ id: "b", issueDate: "2026-11-10" }),
    ]);
    expect(r.bills.map((b) => b.id)).toEqual(["d", "c", "b", "a"]);
  });
});
