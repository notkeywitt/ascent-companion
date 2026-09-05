import { describe, expect, it } from "vitest";
import {
  isSalesTaxLine,
  isTaxRecoverable,
  SALES_TAX_CSI,
  SALES_TAX_LINE_NAME,
  splitSalesTax,
  taxRecoverabilityLabel,
} from "./salesTax";

/**
 * Sales tax is a LINE on a vendor bill, coded 88 80 00. Everything here guards
 * the two things that go wrong if the matcher is loose: a material line read as
 * tax (its cost silently leaves the codeable list) or a tax line read as
 * material (the office can edit sales tax as a line item, and the tax field
 * disagrees with the bill).
 */

describe("isSalesTaxLine", () => {
  it("matches on the cost code, whatever the line is called", () => {
    expect(isSalesTaxLine({ name: "Anything at all", costCode: { number: SALES_TAX_CSI } })).toBe(
      true,
    );
    expect(isSalesTaxLine({ name: "Sales Tax", code: SALES_TAX_CSI })).toBe(true);
  });

  it("trusts the cost code OVER the name when a line carries both", () => {
    // A line coded to real work is material, even if somebody named it "Sales Tax".
    expect(isSalesTaxLine({ name: SALES_TAX_LINE_NAME, costCode: { number: "06 10 00" } })).toBe(
      false,
    );
  });

  it("falls back to the CSI in description for an uncoded tax line", () => {
    // What a bill gets when the job budget has no 88 80 00 leaf.
    expect(isSalesTaxLine({ name: SALES_TAX_LINE_NAME, description: SALES_TAX_CSI })).toBe(true);
  });

  it("falls back to the name, current and legacy", () => {
    expect(isSalesTaxLine({ name: "Sales Tax" })).toBe(true);
    expect(isSalesTaxLine({ name: "Sales Tax (paid)" })).toBe(true);
  });

  it("leaves ordinary lines alone", () => {
    expect(isSalesTaxLine({ name: "Lumber", costCode: { number: "06 10 00" } })).toBe(false);
    expect(isSalesTaxLine({ name: "Tax preparation service" })).toBe(false);
    expect(isSalesTaxLine(null)).toBe(false);
    expect(isSalesTaxLine(undefined)).toBe(false);
    expect(isSalesTaxLine({})).toBe(false);
  });
});

describe("splitSalesTax", () => {
  const lumber = { id: "a", name: "Lumber", cost: 100, costCode: { number: "06 10 00" } };
  const tax = { id: "b", name: SALES_TAX_LINE_NAME, cost: 8.35, costCode: { number: SALES_TAX_CSI } };

  it("pulls the tax line out and reports what it carried", () => {
    const r = splitSalesTax([lumber, tax]);
    expect(r.lines).toEqual([lumber]);
    expect(r.taxAmount).toBe(8.35);
    expect(r.taxLine).toBe(tax);
  });

  it("is a no-op on a bill with no tax", () => {
    const r = splitSalesTax([lumber]);
    expect(r.lines).toEqual([lumber]);
    expect(r.taxAmount).toBe(0);
    expect(r.taxLine).toBeNull();
  });

  it("reads a legacy bill's tax off the document field", () => {
    const r = splitSalesTax([lumber], 8.35);
    expect(r.lines).toEqual([lumber]);
    expect(r.taxAmount).toBe(8.35);
  });

  it("SUMS a half-migrated bill rather than picking one side", () => {
    // Neither source can be dropped: whichever we ignored would lose money.
    expect(splitSalesTax([lumber, tax], 1.65).taxAmount).toBe(10);
  });

  it("adds up several tax lines, if a bill somehow has more than one", () => {
    expect(splitSalesTax([lumber, tax, { ...tax, id: "c", cost: 1.65 }]).taxAmount).toBe(10);
  });

  it("keeps the sum to the cent", () => {
    expect(splitSalesTax([{ ...tax, cost: 0.1 }, { ...tax, id: "c", cost: 0.2 }]).taxAmount).toBe(
      0.3,
    );
  });
});

describe("isTaxRecoverable", () => {
  it("says NO for Ascent's own overhead — those goods are consumed", () => {
    expect(isTaxRecoverable("Ascent")).toBe(false);
    expect(isTaxRecoverable("ascent")).toBe(false);
    expect(isTaxRecoverable("  Ascent  ")).toBe(false);
    expect(taxRecoverabilityLabel("Ascent")).toBe("Not recoverable");
  });

  it("says YES for client work — those goods are resold", () => {
    expect(isTaxRecoverable("Active")).toBe(true);
    expect(isTaxRecoverable("PreCon")).toBe(true);
    expect(isTaxRecoverable("Complete")).toBe(true);
    expect(taxRecoverabilityLabel("Active")).toBe("Recoverable");
  });

  it("treats an unknown phase as client work, so nothing is silently dropped", () => {
    expect(isTaxRecoverable("")).toBe(true);
    expect(isTaxRecoverable(null)).toBe(true);
    expect(isTaxRecoverable(undefined)).toBe(true);
  });
});
