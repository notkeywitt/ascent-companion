import { describe, expect, it } from "vitest";
import vectorFile from "./billing-vectors.json";
import {
  companyDateParts,
  computeBillDates,
  computeLineTaxability,
  deriveBillingPeriod,
  taxReconcileWarning,
} from "./billing";

/**
 * The billing-period rule, plus the bill-date derivation built on it.
 *
 * `deriveBillingPeriod` exists TWICE — here and in ascent-appscript/Config.js —
 * and both files warn that re-deriving it from scratch has caused production
 * bugs. The shared vectors below are the contract between the two; the Apps
 * Script side runs the same table via diagnoseBillingPeriodVectors().
 *
 * The rest (issue/due dates, taxability) is TypeScript-only: the Apps Script
 * counterpart `_jtComputeBillDates` reads its inputs straight off a sheet row,
 * so it can't be driven from a fixture without a large harness. Those cases are
 * still worth pinning here — the logic is what a bill's dates depend on.
 */

const { vectors } = vectorFile as {
  vectors: {
    name: string;
    receivedUtc: string;
    isSunset: boolean;
    billingMonthNum: number;
    billingYear: number;
  }[];
};

describe("deriveBillingPeriod — shared golden vectors", () => {
  it("has a non-trivial table covering both vendor kinds", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(15);
    expect(vectors.some((v) => v.isSunset)).toBe(true);
    expect(vectors.some((v) => !v.isSunset)).toBe(true);
  });

  it.each(vectors)("$name", (v) => {
    const got = deriveBillingPeriod(new Date(v.receivedUtc), v.isSunset);
    expect(got).toEqual({ billingMonthNum: v.billingMonthNum, billingYear: v.billingYear });
  });
});

describe("companyDateParts", () => {
  it("reads the date in Pacific, not UTC", () => {
    // 06:00Z on Jul 11 is 23:00 on Jul 10 in Los Angeles.
    expect(companyDateParts(new Date("2026-07-11T06:00:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 10,
    });
  });
});

describe("computeBillDates", () => {
  it("non-Sunset: issues on the LAST day of the billing month", () => {
    // Arrives Jul 15 → July billing → issue Jul 31.
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), false);
    expect(d.issueDate).toBe("2026-07-31");
    expect(d.billing).toEqual({ billingMonthNum: 7, billingYear: 2026 });
  });

  it("non-Sunset arriving on the 10th: issues on the last day of the PREVIOUS month", () => {
    const d = computeBillDates(new Date("2026-07-10T19:00:00Z"), false);
    expect(d.issueDate).toBe("2026-06-30");
  });

  it("handles a February billing month, including a leap year", () => {
    expect(computeBillDates(new Date("2026-02-15T19:00:00Z"), false).issueDate).toBe("2026-02-28");
    expect(computeBillDates(new Date("2028-02-15T19:00:00Z"), false).issueDate).toBe("2028-02-29");
  });

  it("non-Sunset with no usable due date falls back to net-30", () => {
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), false);
    expect(d.dueDate).toBeNull();
    expect(d.dueDays).toBe(30);
  });

  it("non-Sunset keeps a usable extracted due date", () => {
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), false, "2026-08-30");
    expect(d.dueDate).toBe("2026-08-30");
    expect(d.dueDays).toBeNull();
  });

  it("rejects a due date BEFORE the issue date and warns", () => {
    // JobTread refuses due < issue, so a stale extracted date must not pass through.
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), false, "2026-01-01");
    expect(d.dueDate).toBeNull();
    expect(d.dueDays).toBe(30);
    expect(d.warnings.join(" ")).toMatch(/precedes issue date/i);
  });

  it("ignores a malformed extracted due date", () => {
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), false, "not-a-date");
    expect(d.dueDate).toBeNull();
    expect(d.dueDays).toBe(30);
  });

  it("Sunset: keeps its ARRIVAL date as the issue date", () => {
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), true);
    expect(d.issueDate).toBe("2026-07-15");
  });

  it("Sunset: due on the 10th of the month AFTER the billing month", () => {
    const d = computeBillDates(new Date("2026-07-15T19:00:00Z"), true);
    expect(d.dueDate).toBe("2026-08-10");
  });

  it("Sunset in December: due date rolls into the next year", () => {
    const d = computeBillDates(new Date("2026-12-15T19:00:00Z"), true);
    expect(d.issueDate).toBe("2026-12-15");
    expect(d.dueDate).toBe("2027-01-10");
  });

  it("Sunset respects the Pacific boundary for its issue date", () => {
    // 11pm Pacific on Jul 10 → the issue date is Jul 10, not Jul 11.
    expect(computeBillDates(new Date("2026-07-11T06:00:00Z"), true).issueDate).toBe("2026-07-10");
  });
});

describe("computeLineTaxability", () => {
  it("a document showing tax makes lines NON-taxable (tax rides on the doc)", () => {
    expect(computeLineTaxability(12.34)).toEqual({ lineIsTaxable: false, taxAmount: 12.34 });
  });

  it("no tax shown leaves lines taxable", () => {
    expect(computeLineTaxability(0)).toEqual({ lineIsTaxable: true, taxAmount: 0 });
    expect(computeLineTaxability(null)).toEqual({ lineIsTaxable: true, taxAmount: 0 });
    expect(computeLineTaxability(undefined)).toEqual({ lineIsTaxable: true, taxAmount: 0 });
    expect(computeLineTaxability("nonsense")).toEqual({ lineIsTaxable: true, taxAmount: 0 });
  });
});

describe("taxReconcileWarning", () => {
  it("stays silent when lines + tax equal the amount", () => {
    expect(
      taxReconcileWarning({ Amount: 110, Tax: 10, items: [{ line_total: 100 }] }),
    ).toBeNull();
  });

  it("tolerates rounding within a nickel", () => {
    expect(
      taxReconcileWarning({ Amount: 110.03, Tax: 10, items: [{ line_total: 100 }] }),
    ).toBeNull();
  });

  it("warns when the numbers don't reconcile — a possible missed sales tax", () => {
    const w = taxReconcileWarning({ Amount: 200, Tax: 10, items: [{ line_total: 100 }] });
    expect(w).toMatch(/off by/i);
  });

  it("computes a line total from price × quantity when line_total is absent", () => {
    expect(
      taxReconcileWarning({ Amount: 110, Tax: 10, items: [{ price: 25, quantity: 4 }] }),
    ).toBeNull();
  });

  it("defaults a missing quantity to 1", () => {
    expect(taxReconcileWarning({ Amount: 110, Tax: 10, items: [{ price: 100 }] })).toBeNull();
  });

  it("has nothing to check without an amount or items", () => {
    expect(taxReconcileWarning({ Amount: 0, Tax: 0, items: [] })).toBeNull();
    expect(taxReconcileWarning({ Amount: 100, Tax: 0, items: [] })).toBeNull();
  });
});
