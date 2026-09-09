import { describe, expect, it } from "vitest";
import vectorFile from "./billing-vectors.json";
import {
  billSide,
  billingMonthStale,
  compareBillSides,
  companyDateParts,
  computeBillDates,
  salesTaxAmount,
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

describe("salesTaxAmount", () => {
  it("reads the tax the extractor found, to the cent", () => {
    expect(salesTaxAmount(12.34)).toBe(12.34);
    expect(salesTaxAmount("12.345")).toBe(12.35);
  });

  it("treats absent, zero, negative and unparseable alike as no tax", () => {
    expect(salesTaxAmount(0)).toBe(0);
    expect(salesTaxAmount(null)).toBe(0);
    expect(salesTaxAmount(undefined)).toBe(0);
    expect(salesTaxAmount("nonsense")).toBe(0);
    expect(salesTaxAmount(-5)).toBe(0);
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

describe("a billing month set by hand overrides the 10th cutoff", () => {
  // Noon Pacific on each day, so the company timezone conversion is unambiguous.
  const noonPacific = (iso: string) => new Date(`${iso}T19:00:00Z`);

  it("files a non-Sunset bill in the set month, however late in the month", () => {
    // The 25th: the cutoff would say September. The office is still on August.
    const got = deriveBillingPeriod(noonPacific("2026-09-25"), false, "2026-08");
    expect(got).toEqual({ billingMonthNum: 8, billingYear: 2026 });
  });

  it("leaves Sunset on its arrival month", () => {
    const got = deriveBillingPeriod(noonPacific("2026-09-25"), true, "2026-08");
    expect(got).toEqual({ billingMonthNum: 9, billingYear: 2026 });
  });

  it("falls back to the cutoff when nothing is set or the value is junk", () => {
    const d = noonPacific("2026-09-05");
    const cutoff = { billingMonthNum: 8, billingYear: 2026 };
    expect(deriveBillingPeriod(d, false)).toEqual(cutoff);
    expect(deriveBillingPeriod(d, false, "")).toEqual(cutoff);
    expect(deriveBillingPeriod(d, false, "2026-13")).toEqual(cutoff);
    expect(deriveBillingPeriod(d, false, "August")).toEqual(cutoff);
  });

  it("carries the set month into the bill's issue date", () => {
    const dates = computeBillDates(noonPacific("2026-09-25"), false, undefined, "2026-08");
    expect(dates.issueDate).toBe("2026-08-31");
    expect(dates.warnings.some((w) => w.includes("2026-08"))).toBe(true);
  });

  it("says nothing when the set month agrees with the cutoff", () => {
    const dates = computeBillDates(noonPacific("2026-09-05"), false, undefined, "2026-08");
    expect(dates.warnings).toEqual([]);
  });
});

describe("billingMonthStale — when the month goes red", () => {
  const noonPacific = (iso: string) => new Date(`${iso}T19:00:00Z`);

  it("stays quiet up to and including the 10th", () => {
    expect(billingMonthStale(noonPacific("2026-09-10"), "2026-08")).toBe(false);
  });

  it("goes red on the 11th while the month is still behind", () => {
    expect(billingMonthStale(noonPacific("2026-09-11"), "2026-08")).toBe(true);
  });

  it("clears once the month is switched", () => {
    expect(billingMonthStale(noonPacific("2026-09-11"), "2026-09")).toBe(false);
  });

  it("does not nag about a month set ahead", () => {
    expect(billingMonthStale(noonPacific("2026-09-11"), "2026-10")).toBe(false);
  });

  it("compares across a year boundary", () => {
    expect(billingMonthStale(noonPacific("2026-01-15"), "2025-12")).toBe(true);
  });
});

describe("compareBillSides — a revised invoice under the same number", () => {
  const line = (name: string, amount: number) => ({ name, csi: "06 10 20", coded: true, amount });

  it("sees the sub's added charges as an increase", () => {
    // The real case: bill 1016 came back with extra work on it.
    const onFile = billSide([line("Labor #2", 240), line("Materials", 13.05)], 0);
    const revised = billSide(
      [line("Labor #2", 240), line("Materials", 13.05), line("Extra trim", 480)],
      0,
    );
    const { delta, changed } = compareBillSides(onFile, revised);
    expect(changed).toBe(true);
    expect(delta).toBe(480);
  });

  it("counts tax in the total, so a tax-only revision is caught", () => {
    const onFile = billSide([line("Lumber", 100)], 0);
    const revised = billSide([line("Lumber", 100)], 8.7);
    expect(compareBillSides(onFile, revised)).toEqual({ delta: 8.7, changed: true });
  });

  it("calls a plain re-upload unchanged, through float noise", () => {
    const onFile = billSide([line("a", 0.1), line("b", 0.2)], 0);
    const revised = billSide([line("a", 0.1), line("b", 0.2)], 0);
    expect(onFile.net).toBe(0.3); // not 0.30000000000000004
    expect(compareBillSides(onFile, revised).changed).toBe(false);
  });

  it("flags a re-cut invoice that splits a charge at the same money", () => {
    const onFile = billSide([line("Framing", 600)], 0);
    const revised = billSide([line("Framing labor", 400), line("Framing material", 200)], 0);
    const { delta, changed } = compareBillSides(onFile, revised);
    expect(delta).toBe(0);
    expect(changed).toBe(true);
  });

  it("ignores a rounding-sized difference", () => {
    const onFile = billSide([line("Lumber", 100)], 0);
    const revised = billSide([line("Lumber", 100.04)], 0);
    expect(compareBillSides(onFile, revised).changed).toBe(false);
  });
});
