import { describe, expect, it } from "vitest";

import {
  summarizeClientDocs,
  summarizeCostLines,
  summarizeJobFinancials,
  summarizeOpenInvoices,
  summarizeVendorBills,
} from "./botFinancials";
import type { ClientDocRow, CostCodeRow, JobCostDetail, OpenInvoiceRow } from "./jobtread";

const split = { labor: 0, allowance: 0, sub: 0, vendor: 0, other: 0 };
const code = (number: string, name: string, budget: number, bills: number, labor: number): CostCodeRow => ({
  number,
  name,
  division: number.slice(0, 2),
  budget,
  bills,
  labor,
  laborHours: labor / 50,
  laborApproved: labor,
  laborApprovedHours: labor / 50,
  invoiced: bills,
  currentInvoice: 0,
  split,
  lines: [],
});

const detail: JobCostDetail = {
  divisions: [
    {
      division: "06",
      name: "Wood",
      budget: 10_000,
      bills: 9_000,
      labor: 2_000,
      laborHours: 40,
      laborApproved: 2_000,
      laborApprovedHours: 40,
      invoiced: 9_000,
      currentInvoice: 0,
      split,
      codes: [code("06 10 00", "Rough Carpentry", 10_000, 9_000, 2_000)],
    },
    {
      division: "26",
      name: "Electrical",
      budget: 5_000,
      bills: 1_000,
      labor: 0,
      laborHours: 0,
      laborApproved: 0,
      laborApprovedHours: 0,
      invoiced: 1_000,
      currentInvoice: 0,
      split,
      codes: [code("26 05 00", "Wiring", 5_000, 1_000, 0)],
    },
  ],
  budgetBasis: "customerOrders",
  budgetTotal: 15_000,
  billsTotal: 10_000,
  laborTotal: 2_000,
  laborHoursTotal: 40,
  invoicedTotal: 10_000,
  currentInvoiceTotal: 0,
  currentInvoiceLabel: null,
  degraded: [],
};

describe("summarizeJobFinancials", () => {
  it("gives the job's totals and lists the most over-budget code first", () => {
    const r = summarizeJobFinancials(detail, []);
    expect(r.totals).toMatchObject({ budget: 15_000, spent: 12_000, left: 3_000 });
    expect(r.codes[0]).toMatchObject({ code: "06 10 00 Rough Carpentry", left: -1_000 });
  });

  it("narrows to matching codes or divisions, totals included", () => {
    const r = summarizeJobFinancials(detail, ["elec"]);
    expect(r.codes.map((c) => c.code)).toEqual(["26 05 00 Wiring"]);
    expect(r.totals).toMatchObject({ budget: 5_000, spentOnBills: 1_000, left: 4_000 });
  });
});

describe("summarizeCostLines", () => {
  it("totals bills by vendor and gives labor per code, not per person", () => {
    const r = summarizeCostLines(
      {
        bills: [
          { id: "1", docId: "d1", code: "06 10 00", vendor: "Sunset", label: "#5", issueDate: "2026-09-01", status: "approved", lineName: "Studs", cost: 100 },
          { id: "2", docId: "d2", code: "06 10 00", vendor: "Sunset", label: "#6", issueDate: "2026-10-01", status: "pending", lineName: "Plates", cost: 50.5 },
          { id: "3", docId: "d3", code: "26 05 00", vendor: "Platt", label: "#7", issueDate: "2026-10-02", status: "approved", lineName: "Wire", cost: 20 },
        ],
        time: [
          { id: "t1", code: "06 10 00", employee: "Seth", startedAt: null, hours: 8, cost: 400, notes: "", isApproved: true },
        ],
      },
      ["06"],
    );
    expect(r.billTotal).toBe(150.5);
    expect(r.byVendor).toEqual([{ name: "Sunset", cost: 150.5 }]);
    expect(r.newest[0]).toMatchObject({ bill: "#6" });
    expect(r.laborByCode).toEqual([{ code: "06 10 00", hours: 8, cost: 400 }]);
    expect(JSON.stringify(r)).not.toMatch(/Seth/);
  });
});

const doc = (over: Partial<ClientDocRow>): ClientDocRow => ({
  id: "x",
  type: "customerInvoice",
  name: "Monthly Invoice",
  number: "1",
  status: "approved",
  issueDate: "2026-09-01",
  dueDate: "2026-10-01",
  price: 0,
  total: 0,
  amountPaid: 0,
  balance: 0,
  includeInBudget: true,
  ...over,
});

describe("summarizeClientDocs", () => {
  it("counts the approved contract and live invoices, never drafts or denied ones", () => {
    const r = summarizeClientDocs([
      doc({ type: "customerOrder", name: "Proposal", price: 100_000, total: 108_000 }),
      doc({ type: "customerOrder", name: "Change Order", price: 5_000, total: 5_400, status: "pending" }),
      doc({ number: "10", total: 2_000, amountPaid: 2_000 }),
      doc({ number: "11", total: 3_000, amountPaid: 1_000, balance: 2_000, status: "pending" }),
      doc({ number: "12", total: 9_999, status: "draft" }),
      doc({ number: "13", total: 7_777, status: "denied" }),
    ]);
    expect(r.totals).toEqual({
      contractWithTax: 108_000,
      contractBeforeTax: 100_000,
      invoicedWithTax: 5_000,
      paid: 3_000,
      owed: 2_000,
      draftInvoices: 1,
    });
    expect(r.invoices).toHaveLength(4);
  });
});

describe("summarizeOpenInvoices", () => {
  const inv = (number: string, due: string, balance: number): OpenInvoiceRow => ({
    id: number,
    number,
    status: "approved",
    jobId: "j",
    jobName: "Berger",
    customerName: "Kevin Berger",
    issueDate: "2026-08-01",
    dueDate: due,
    total: balance,
    amountPaid: 0,
    balance,
  });

  it("puts the oldest debt first and buckets it by days late", () => {
    const r = summarizeOpenInvoices(
      [inv("1", "2026-10-30", 100), inv("2", "2026-09-15", 200), inv("3", "2026-06-01", 300), inv("4", "2026-10-01", 0)],
      "2026-10-30",
      [],
    );
    expect(r.count).toBe(3);
    expect(r.owed).toBe(600);
    expect(r.invoices.map((i) => i.invoice)).toEqual(["3", "2", "1"]);
    expect(r.aging).toMatchObject({ current: 100, "31-60 days late": 200, "over 90 days late": 300 });
  });
});

describe("summarizeVendorBills", () => {
  it("totals live bills since a date, by job and year", () => {
    const r = summarizeVendorBills(
      [
        { id: "1", number: 9, jobId: "a", jobName: "Berger", cost: 100, status: "approved", issueDate: "2026-03-01" },
        { id: "2", number: 8, jobId: "b", jobName: "Keeler", cost: 50, status: "draft", issueDate: "2026-02-01" },
        { id: "3", number: 7, jobId: "a", jobName: "Berger", cost: 70, status: "denied", issueDate: "2026-01-15" },
        { id: "4", number: 6, jobId: "a", jobName: "Berger", cost: 999, status: "approved", issueDate: "2025-12-01" },
      ],
      "2026-01-01",
    );
    expect(r.bills).toBe(3);
    expect(r.total).toBe(100);
    expect(r.byJob).toEqual([{ name: "Berger", cost: 100, bills: 1 }]);
  });
});
