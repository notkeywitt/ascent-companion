/**
 * DRAFT CUSTOMER INVOICE — the pure builder.
 *
 * The draft is a real document in the live JobTread org, and its references
 * are what stop the next invoice billing the same cost again. So the tree, the
 * references, the total and the issue date are pinned exactly: a draft that
 * totals a cent off the preview, or leaves a bill unreferenced, is the failure.
 */
import { describe, expect, it } from "vitest";
import { buildInvoiceDraft, type DraftBillLine, type InvoiceDraftSource } from "./invoiceDraft";

const line = (over: Partial<DraftBillLine> & { billId: string; cost: number }): DraftBillLine => ({
  name: "Line",
  description: null,
  quantity: 1,
  unitCost: over.cost,
  isTaxable: true,
  jobCostItemId: "LEAF-31",
  costCodeId: "CC-312300",
  code: "31 23 00",
  codeName: "Excavation and Fill",
  costTypeId: "CT-OTHER",
  unitId: null,
  ...over,
});

// Markup 1.18. Fee, worked the preview's way (per bill item, per day per leaf):
//   160 → 28.80 · 270 → 48.60 · 100.33 → 18.06 · 332.50 → 59.85 · 85 → 15.30
const source = (over: Partial<InvoiceDraftSource> = {}): InvoiceDraftSource => ({
  jobId: "JOB1",
  year: 2026,
  month: 10,
  uninvoiced: {
    customer: { id: "A1", name: "Ruhmann-Warren" },
    job: { id: "JOB1", name: "Beach Shack" },
    total: 947.83,
    lines: [
      {
        key: "B1",
        label: "Dirt Doctors",
        cost: 430,
        billIds: ["B1"],
        isSunset: false,
        bills: [{ id: "B1", label: "INV-f29", cost: 430, invoiced: false }],
      },
      {
        key: "time",
        label: "Time & labor (3 entries)",
        cost: 417.5,
        billIds: [],
        isSunset: false,
        timeEntries: [
          { id: "T1", employee: "Ty", hours: 2, rate: 95, cost: 190, costItemId: "LEAF-PM", startedAt: "2026-10-14T16:00:00.000Z" },
          { id: "T2", employee: "Casey", hours: 1.5, rate: 95, cost: 142.5, costItemId: "LEAF-PM", startedAt: "2026-10-14T21:00:00.000Z" },
          { id: "T3", employee: "Ty", hours: 1, rate: 85, cost: 85, costItemId: "LEAF-PM", startedAt: "2026-10-02T17:00:00.000Z" },
        ],
      },
      {
        key: "sunset",
        label: "Sunset Builders Supply (1 invoice)",
        cost: 100.33,
        billIds: ["B2"],
        isSunset: true,
        bills: [{ id: "B2", label: "S-7781", cost: 100.33, invoiced: false }],
      },
    ],
    invoice: {
      jobNumber: "43",
      address: "",
      accountName: "",
      contactName: "",
      email: "",
      markup: 1.18,
      fee: 170.61,
      divisions: { "31 00 00": "Earthwork", "01 00 00": "General Requirements" },
    },
  },
  billLines: [
    line({ billId: "B1", cost: 160, name: "Move-in" }),
    line({ billId: "B1", cost: 270, quantity: 2, unitCost: 135, name: "Dig" }),
    line({
      billId: "B2",
      cost: 100.33,
      name: "Lumber",
      isTaxable: false,
      jobCostItemId: "LEAF-PERMIT",
      code: "01 31 40",
      codeName: "Permits and Fees",
    }),
  ],
  leaves: {
    "LEAF-PM": {
      id: "LEAF-PM",
      name: "Project Management",
      costCodeId: "CC-013110",
      code: "01 31 10",
      codeName: "Project Management",
      costTypeId: "CT-LABOR",
      unitId: "U-HOURS",
    },
  },
  header: {
    fromName: "Ascent Building Co.",
    fromAddress: "4223 Center Rd",
    toName: "Don Ruhmann",
    toAddress: "149 Peninsula Rd",
    jobLocationName: "Ruhmann-Warren",
    jobLocationAddress: "149 Peninsula Rd",
    taxRate: 0.0835,
  },
  ...over,
});

const names = (items: any[]): any[] =>
  items.map((i) => (i._type === "costGroup" ? { [i.name]: names(i.lineItems) } : i.name));
const allLines = (items: any[]): any[] =>
  items.flatMap((i) => (i._type === "costGroup" ? allLines(i.lineItems) : [i]));

describe("buildInvoiceDraft", () => {
  it("builds division → code → bill / day → lines", () => {
    const { input } = buildInvoiceDraft(source());
    expect(names(input.lineItems)).toEqual([
      {
        "01 00 00 General Requirements": [
          { "01 31 10 Project Management": [
            { "Time Cost for Wed, Oct 14, 2026": ["Project Management"] },
            { "Time Cost for Fri, Oct 2, 2026": ["Project Management"] },
          ] },
          { "01 31 40 Permits and Fees": [{ "Sunset Builders Supply Bill S-7781": ["Lumber"] }] },
        ],
      },
      {
        "31 00 00 Earthwork": [
          { "31 23 00 Excavation and Fill": [{ "Dirt Doctors Bill INV-f29": ["Move-in", "Dig"] }] },
        ],
      },
    ]);
    const billGroup = input.lineItems[1].lineItems[0].lineItems[0];
    expect(billGroup.description).toBe("Beach Shack - Dirt Doctors");
  });

  it("references every bill and time entry", () => {
    const { input, billIds, timeEntryIds } = buildInvoiceDraft(source());
    expect(billIds).toEqual(["B1", "B2"]);
    expect(timeEntryIds).toEqual(["T1", "T2", "T3"]);
    expect(input.references).toEqual([
      { _type: "document", id: "B1" },
      { _type: "document", id: "B2" },
      { _type: "timeEntry", id: "T1" },
      { _type: "timeEntry", id: "T2" },
      { _type: "timeEntry", id: "T3" },
    ]);
  });

  it("totals the preview to the cent, line by line", () => {
    const { input, price } = buildInvoiceDraft(source());
    expect(price).toBe(1118.44); // 947.83 + 170.61
    const lines = allLines(input.lineItems);
    const sum = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100) / 100, 0);
    expect(Math.round(sum * 100) / 100).toBe(1118.44);
    const day = lines.find((l) => l.quantity === 3.5);
    expect(day).toMatchObject({ jobCostItemId: "LEAF-PM", unitId: "U-HOURS", unitCost: 95, isTaxable: true });
    expect(lines.find((l) => l.name === "Lumber")).toMatchObject({ isTaxable: false, unitPrice: 118.39 });
  });

  it("sends quantity 1 for a bill line that holds no quantity, so it does not land at $0", () => {
    const s = source();
    s.billLines[0] = { ...s.billLines[0], quantity: 0 };
    const move = allLines(buildInvoiceDraft(s).input.lineItems).find((l) => l.name === "Move-in");
    expect(move).toMatchObject({ quantity: 1, unitCost: 160, unitPrice: 188.8 });
  });

  it("carries the header: Monthly Invoice, dueDays, tax, location", () => {
    const { input } = buildInvoiceDraft(source());
    expect(input).toMatchObject({
      type: "customerInvoice",
      jobId: "JOB1",
      name: "Monthly Invoice",
      dueDays: 15,
      taxRate: 0.0835,
      toName: "Don Ruhmann",
      jobLocationName: "Ruhmann-Warren",
    });
    expect(input.dueDate).toBeUndefined();
    expect(input.qboIsIgnored).toBeUndefined();
  });

  it.each([
    [2026, 10, "2026-10-31"],
    [2026, 11, "2026-11-30"],
    [2028, 2, "2028-02-29"],
    [2026, 2, "2026-02-28"],
  ])("dates %i-%i on the last day of the billing month", (year, month, want) => {
    expect(buildInvoiceDraft(source({ year, month })).input.issueDate).toBe(want);
  });

  it("refuses when there is nothing to invoice", () => {
    const s = source();
    s.uninvoiced = { ...s.uninvoiced, lines: [], total: 0 };
    expect(() => buildInvoiceDraft(s)).toThrow(/Nothing to invoice/);
  });

  it("refuses a line with no budget leaf rather than guess one", () => {
    const s = source();
    s.billLines[0] = { ...s.billLines[0], jobCostItemId: null };
    expect(() => buildInvoiceDraft(s)).toThrow(/no budget item.*Move-in/);
    const t = source({ leaves: {} });
    expect(() => buildInvoiceDraft(t)).toThrow(/Ty's time/);
  });

  it("refuses a draft that would not match the preview", () => {
    const s = source();
    s.uninvoiced = { ...s.uninvoiced, total: 950 };
    expect(() => buildInvoiceDraft(s)).toThrow(/preview shows/);
  });
});
