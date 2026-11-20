/**
 * CLIENT BUDGET REPORT — the row and total math, checked against a hand-worked
 * example.
 *
 *   06 10 00  budget $11,800 (cost $10,000)  billed $5,900  bills $4,000  labor $1,000
 *     remaining 11,800 − 5,900 = 5,900 · 50% invoiced
 *     cost to date 4,000 + 1,000 = 5,000 · cost to complete 10,000 − 5,000 = 5,000
 *   06 20 00  budget $1,180 (cost $1,000)    billed $1,416  bills $1,200
 *     remaining −236 · 120% · cost to complete 1,000 − 1,200 = −200 (over)
 *   09 00 00  no budget, bills $300 → a row with no % invoiced
 *   CD, 88 80 00, 88 90 00 → left out
 *
 *   Division 06: budget 12,980 · billed 7,316 · remaining 5,664 · cost to
 *   date 6,200 · cost to complete 11,000 − 6,200 = 4,800
 *   Job: budget 12,980 · billed 7,316 · cost to date 6,500 · CTC 4,500
 */
import { describe, expect, it } from "vitest";
import { buildClientBudget } from "./clientBudget";

const report = buildClientBudget({
  budgetPrice: { "06 10 00": 11800, "06 20 00": 1180, CD: 0 },
  budgetCost: { "06 10 00": 10000, "06 20 00": 1000 },
  billed: { "06 10 00": 5900, "06 20 00": 1416, CD: -20000 },
  bills: { "06 10 00": 4000, "06 20 00": 1200, "09 00 00": 300, "88 80 00": 95, "88 90 00": 50 },
  labor: { "06 10 00": 1000 },
  codeNames: { "06 10 00": "Rough Carpentry", "06 20 00": "Finish Carpentry" },
  divisionNames: { "06": "Wood, Plastics & Composites" },
});

describe("buildClientBudget", () => {
  it("builds each code's row", () => {
    const [d06] = report.divisions;
    expect(d06.rows[0]).toEqual({
      code: "06 10 00",
      name: "Rough Carpentry",
      budget: 11800,
      billed: 5900,
      remaining: 5900,
      pctInvoiced: 0.5,
      costToDate: 5000,
      costToComplete: 5000,
    });
    expect(d06.rows[1]).toMatchObject({ remaining: -236, costToComplete: -200 });
    expect(d06.rows[1].pctInvoiced).toBeCloseTo(1.2);
  });

  it("keeps deposit, sales tax and warranty out", () => {
    const codes = report.divisions.flatMap((d) => d.rows.map((r) => r.code));
    expect(codes).toEqual(["06 10 00", "06 20 00", "09 00 00"]);
    expect(report.divisions[1].rows[0].pctInvoiced).toBeNull();
  });

  it("totals each division and the job", () => {
    expect(report.divisions[0]).toMatchObject({
      name: "Wood, Plastics & Composites",
      budget: 12980,
      billed: 7316,
      remaining: 5664,
      costToDate: 6200,
      costToComplete: 4800,
    });
    expect(report).toMatchObject({ budget: 12980, billed: 7316, costToDate: 6500, costToComplete: 4500 });
  });
});
