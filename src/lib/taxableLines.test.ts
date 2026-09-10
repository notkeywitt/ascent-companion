/**
 * THE STRAY-isTaxable WORKLIST — and mostly what it must leave OFF.
 *
 * Everything here is pinned from August 2026, the month that motivated the
 * page: 75 flagged lines, 58 of them on Office and Shop, two of them literally
 * named "Sales Tax" and coded 01 00 00.
 *
 * The exclusions are the part worth testing. A missing row costs a click; a
 * wrong row is a person ticking "taxable" onto a line that was right, and on
 * the sales-tax rows that means taxing the tax.
 */
import { describe, expect, it } from "vitest";

import { buildTaxableLinesReport, looksLikeSalesTax, type UntaxedLine } from "./taxableLines";

function line(over: Partial<UntaxedLine> & { id: string }): UntaxedLine {
  return {
    name: "Excavation and Fill",
    cost: 5000,
    price: 0,
    costCode: "31 23 00",
    docKind: "bill",
    docId: "bill-1",
    docNumber: "",
    docIssueDate: "2026-08-31",
    docStatus: "pending",
    docLineCount: 3,
    docAmountPaid: 0,
    vendor: "Dirt Doctors",
    jobId: "J1",
    jobName: "Pole Barn",
    customerName: "Moon Spring Farm LLC",
    ...over,
  };
}

/** An invoice line — priced, so its unbilled tax is exact. */
function invLine(over: Partial<UntaxedLine> & { id: string }): UntaxedLine {
  return line({
    docKind: "invoice",
    docId: "inv-1",
    docNumber: "382",
    docStatus: "draft",
    docIssueDate: "",
    vendor: "",
    cost: 4156.25,
    price: 4904.38,
    ...over,
  });
}

describe("looksLikeSalesTax", () => {
  it("catches a tax line coded 88 80 00", () => {
    expect(looksLikeSalesTax({ name: "Sales Tax", costCode: "88 80 00" })).toBe(true);
  });

  // The August trap. isSalesTaxLine checks the CODE first and only falls back
  // to the name, so a line named "Sales Tax" carrying another code reads as an
  // ordinary line there. Here it must not.
  it("catches a tax line MIS-CODED to something else", () => {
    expect(looksLikeSalesTax({ name: "Sales Tax", costCode: "01 00 00" })).toBe(true);
    expect(looksLikeSalesTax({ name: "Sales Tax (paid)", costCode: "01 00 00" })).toBe(true);
  });

  it("leaves an ordinary line alone", () => {
    expect(looksLikeSalesTax({ name: "Excavation and Fill", costCode: "31 23 00" })).toBe(false);
  });
});

describe("buildTaxableLinesReport", () => {
  it("lists a client job's flagged line and sizes the tax", () => {
    const r = buildTaxableLinesReport("2026-08", [line({ id: "l1" })]);
    expect(r.bills).toHaveLength(1);
    // 5,000 x 1.18 markup x 0.0835.
    expect(r.bills[0].taxAtStake).toBeCloseTo(492.65, 2);
    expect(r.bills[0].estimated).toBe(true);
    expect(r.totals.lines).toBe(1);
    expect(r.totals.billTax).toBeCloseTo(492.65, 2);
    expect(r.invoices).toHaveLength(0);
  });

  it("drops Ascent's own jobs and says how many", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "l1" }),
      line({ id: "l2", jobId: "J9", jobName: "Office", name: "Americano", cost: 3.95 }),
      line({ id: "l3", jobId: "J8", jobName: "Shop", name: "OSC BLD SET 9PC", cost: 82.31 }),
      line({ id: "l4", jobId: "J7", jobName: "Electrical", name: "Wire", cost: 40 }),
    ]);
    expect(r.bills).toHaveLength(1);
    expect(r.skipped.overheadLines).toBe(3);
  });

  it("drops a sales-tax line even when it is mis-coded", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "l1" }),
      line({ id: "l2", name: "Sales Tax", costCode: "01 00 00", cost: 0.72 }),
    ]);
    expect(r.bills).toHaveLength(1);
    expect(r.skipped.salesTaxLines).toBe(1);
    expect(r.totals.lines).toBe(1);
  });

  it("groups lines onto their bill and marks it mixed", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "l1", cost: 30.4, name: "hinge", docLineCount: 3 }),
      line({ id: "l2", cost: 8.95, name: "Shipping.", docLineCount: 3 }),
    ]);
    expect(r.bills).toHaveLength(1);
    expect(r.bills[0].untaxedCount).toBe(2);
    expect(r.bills[0].mixed).toBe(true);
    expect(r.bills[0].cost).toBeCloseTo(39.35, 2);
    // Biggest line first — this is a list somebody works down.
    expect(r.bills[0].lines[0].name).toBe("hinge");
  });

  it("marks a wholly flagged bill as NOT mixed, so the page can warn", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "l1", cost: 420, docLineCount: 2 }),
      line({ id: "l2", cost: 13.05, docLineCount: 2 }),
    ]);
    expect(r.bills[0].mixed).toBe(false);
  });

  it("treats an unreadable line count as mixed rather than dropping it", () => {
    // 0 means the aggregate failed. Keeping it on the list is the safer error:
    // the alternative is quietly calling it a deliberate exemption.
    const r = buildTaxableLinesReport("2026-08", [line({ id: "l1", docLineCount: 0 })]);
    expect(r.bills[0].mixed).toBe(true);
  });

  it("orders bills by what they cost the client invoice", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "l1", docId: "small", cost: 8.95, vendor: "MyKnobs.com" }),
      line({ id: "l2", docId: "big", cost: 5000, vendor: "Dirt Doctors" }),
      line({ id: "l3", docId: "mid", cost: 4156.25, vendor: "Element Smart Roofing" }),
    ]);
    expect(r.bills.map((b) => b.docId)).toEqual(["big", "mid", "small"]);
  });

  // The reason the two lists exist: a pushed or paid bill cannot be edited, so
  // the invoice is the only side the office can reach.
  it("keeps invoice lines and bill lines apart", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "b1" }),
      invLine({ id: "i1" }),
    ]);
    expect(r.bills.map((d) => d.docId)).toEqual(["bill-1"]);
    expect(r.invoices.map((d) => d.docId)).toEqual(["inv-1"]);
  });

  it("prices an invoice line exactly and a bill line as an estimate", () => {
    const r = buildTaxableLinesReport("2026-08", [
      invLine({ id: "i1", price: 4904.38 }),
      line({ id: "b1", cost: 4156.25 }),
    ]);
    // The invoice knows what the client is charged: 4,904.38 x 0.0835.
    expect(r.invoices[0].estimated).toBe(false);
    expect(r.invoices[0].taxAtStake).toBeCloseTo(409.52, 2);
    // The bill has no price, so it adds the markup and says it is a guess.
    expect(r.bills[0].estimated).toBe(true);
    expect(r.bills[0].taxAtStake).toBeCloseTo(409.52, 1);
    expect(r.totals.invoiceTax).toBeCloseTo(409.52, 2);
  });

  it("marks a PAID bill locked, and never an invoice", () => {
    const r = buildTaxableLinesReport("2026-08", [
      line({ id: "b1", docAmountPaid: 25083.75 }),
      invLine({ id: "i1", docAmountPaid: 43412.48 }),
    ]);
    expect(r.bills[0].locked).toBe(true);
    // An invoice with payments against it is still the side that can be fixed.
    expect(r.invoices[0].locked).toBe(false);
  });

  it("carries the assumptions back out, so the page can state them", () => {
    const r = buildTaxableLinesReport("2026-08", [line({ id: "l1" })], {
      markup: 1.2,
      taxRate: 0.09,
    });
    expect(r.markup).toBe(1.2);
    expect(r.taxRate).toBe(0.09);
    expect(r.bills[0].taxAtStake).toBeCloseTo(540, 2);
  });
});
