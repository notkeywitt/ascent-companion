import { describe, expect, it } from "vitest";
import {
  CO_LOG_START,
  buildCoInput,
  checkCo,
  coTotals,
  groupLog,
  inLog,
  markupFromMargin,
  priceOf,
  type CoHeader,
  type CoInput,
  type CoRow,
} from "./changeOrders";

// Job 37, the test job, as JobTread held it on 2026-11-23.
const JOB37 = "22Pi4qW5bdmr";
const HEADER: CoHeader = {
  fromName: "Ascent Building Co.",
  fromAddress: "4223 Center Rd, Lopez Island, WA 98261, USA",
  toName: "test",
  toAddress: "1361 Davis Bay Rd, Lopez Island, WA 98261, USA",
  jobLocationName: "1361 Davis Bay Road",
  jobLocationAddress: "1361 Davis Bay Rd, Lopez Island, WA 98261, USA",
  taxRate: 0.0835,
  unitId: "22PXG7ZsAywn", // Allowance
};
const SUB = "22PXG7ZtBLYa"; // Subcontractor
const LABOR = "22PXG7Zt8iGY";

const input = (over: Partial<CoInput> = {}): CoInput => ({
  jobId: JOB37,
  title: "Added outlets",
  reason: "Owner asked for two more kitchen outlets.",
  markup: 1.18,
  lines: [
    { costCodeId: "cc-elec", code: "26 05 00", codeName: "Electrical", costTypeId: SUB, name: "Two outlets", cost: 400, isTaxable: true },
    { costCodeId: "cc-gl", code: "01 31 30", codeName: "Consumables", costTypeId: LABOR, name: "Patch drywall", description: "2 hrs", cost: 150.5, isTaxable: true },
    { costCodeId: "cc-elec", code: "26 05 00", codeName: "Electrical", costTypeId: SUB, name: "Permit fee", cost: 60, isTaxable: false },
  ],
  ...over,
});

describe("pricing", () => {
  it("turns JobTread's cost-type margin into its 18% markup", () => {
    expect(markupFromMargin(0.15254237288135594)).toBe(1.18);
    expect(markupFromMargin(null)).toBe(1);
    expect(markupFromMargin(1)).toBe(1);
  });
  it("prices like Studio's CO #18: 6,381.32 at 18% = 7,529.96", () => {
    // JobTread showed 7,529.58 there because that line's markup came from the budget, not 18% flat.
    expect(priceOf(6381.32, 1.18)).toBe(7529.96);
    expect(priceOf(100, 1.18)).toBe(118);
  });
  it("totals price, tax on taxable lines only, and the total", () => {
    const t = coTotals(input(), 0.0835);
    expect(t.cost).toBe(610.5);
    expect(t.price).toBe(472 + 177.59 + 70.8);
    expect(t.tax).toBe(Math.round((472 + 177.59) * 0.0835 * 100) / 100);
    expect(t.total).toBe(Math.round((t.price + t.tax) * 100) / 100);
  });
});

describe("checkCo", () => {
  it("passes a complete change order", () => expect(checkCo(input())).toEqual([]));
  it("names every missing piece", () => {
    const p = checkCo(input({ jobId: "", title: " ", markup: 0.5, lines: [{ ...input().lines[0], costCodeId: "", name: "", cost: NaN }] }));
    expect(p).toEqual([
      "Pick a job.",
      "Give the change order a title.",
      "Markup must be between 0% and 200%.",
      "Line 1: pick a cost code.",
      "Line 1: say what it is.",
      "Line 1: enter a cost.",
    ]);
  });
  it("needs a line", () => expect(checkCo(input({ lines: [] }))).toContain("Add at least one line."));
  it("allows a credit (negative cost)", () =>
    expect(checkCo(input({ lines: [{ ...input().lines[0], cost: -200 }] }))).toEqual([]));
});

describe("buildCoInput — the createDocument input for Job 37", () => {
  const doc = buildCoInput(input(), HEADER) as any;
  it("is a draft-able customer order named for the org's Change Order template", () => {
    expect(doc).toMatchObject({
      type: "customerOrder",
      jobId: JOB37,
      name: "Change Order",
      subject: "Added outlets",
      description: "Owner asked for two more kitchen outlets.",
      taxRate: 0.0835,
      dueDays: 30,
      requireSignature: true,
      includeInBudget: true,
      toName: "test",
      jobLocationName: "1361 Davis Bay Road",
    });
    expect(doc.status).toBeUndefined();
  });
  it("groups lines by cost code, in code order", () => {
    expect(doc.lineItems.map((g: any) => g.name)).toEqual(["01 31 30 Consumables", "26 05 00 Electrical"]);
    expect(doc.lineItems[1].lineItems.map((l: any) => l.name)).toEqual(["Two outlets", "Permit fee"]);
  });
  it("prices each line at quantity 1, cost × markup, on the Allowance unit", () => {
    expect(doc.lineItems[1].lineItems[0]).toEqual({
      _type: "costItem",
      name: "Two outlets",
      costCodeId: "cc-elec",
      costTypeId: SUB,
      unitId: "22PXG7ZsAywn",
      quantity: 1,
      unitCost: 400,
      unitPrice: 472,
      isTaxable: true,
    });
    expect(doc.lineItems[0].lineItems[0]).toMatchObject({ description: "2 hrs", unitCost: 150.5, unitPrice: 177.59 });
    expect(doc.lineItems[1].lineItems[1].isTaxable).toBe(false);
  });
  it("never links a line to a budget item", () => {
    const all = doc.lineItems.flatMap((g: any) => g.lineItems);
    expect(all.every((l: any) => !("jobCostItemId" in l))).toBe(true);
  });
  it("refuses a bad input", () => expect(() => buildCoInput(input({ title: "" }), HEADER)).toThrow("title"));
});

const row = (over: Partial<CoRow>): CoRow => ({
  id: "x",
  number: "1",
  title: "",
  status: "draft",
  price: 0,
  total: 0,
  issueDate: "",
  createdAt: "2026-11-23T06:23:55.499Z",
  jobId: JOB37,
  jobName: "Job 37",
  jobNumber: "37",
  customer: "Tester",
  ...over,
});

describe("the log", () => {
  it("starts on the day it was asked for, so Bunkhouse #70 and Studio #18 stay out", () => {
    expect(CO_LOG_START).toBe("2026-11-23");
    expect(inLog(row({ id: "22PiaTzzBh8M" }))).toBe(true); // Job 37's draft #10
    expect(inLog(row({ id: "studio18", createdAt: "2026-11-04T18:00:00Z" }))).toBe(false);
  });

  const rows = [
    row({ id: "a", number: "10", jobId: "j37", jobName: "Job 37", createdAt: "2026-11-23T06:00:00Z", price: 100 }),
    row({ id: "b", number: "19", jobId: "studio", jobName: "Studio", customer: "Gormley", createdAt: "2026-11-25T06:00:00Z", status: "approved", price: 500 }),
    row({ id: "c", number: "11", jobId: "j37", jobName: "Job 37", createdAt: "2026-11-24T06:00:00Z", status: "pending", price: 50 }),
    row({ id: "d", number: "12", jobId: "j37", jobName: "Job 37", createdAt: "2026-11-26T06:00:00Z", status: "denied", price: 999 }),
  ];
  it("groups by job, newest first, the job with the latest change order on top", () => {
    const g = groupLog(rows, { status: "", jobId: "" }, "recent", "job");
    expect(g.map((x) => x.label)).toEqual(["Tester - Job 37", "Gormley - Studio"]);
    expect(g[0].rows.map((r) => r.id)).toEqual(["d", "c", "a"]);
    expect(g[0]).toMatchObject({ approved: 0, open: 150 });
    expect(g[1]).toMatchObject({ approved: 500, open: 0 });
  });
  it("filters by status and job, sorts by amount, and can drop the grouping", () => {
    expect(groupLog(rows, { status: "pending", jobId: "" }, "recent", "none")[0].rows.map((r) => r.id)).toEqual(["c"]);
    expect(groupLog(rows, { status: "", jobId: "studio" }, "recent", "none")[0].rows.map((r) => r.id)).toEqual(["b"]);
    expect(groupLog(rows, { status: "", jobId: "" }, "amount", "none")[0].rows.map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
    expect(groupLog(rows, { status: "", jobId: "" }, "oldest", "status").map((x) => x.label)).toEqual(["Draft", "Sent", "Approved", "Void"]);
  });
});
