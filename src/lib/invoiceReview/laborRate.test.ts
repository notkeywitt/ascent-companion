import { describe, expect, it } from "vitest";
import { laborRateCheck, type LaborRateConfig } from "./checks/laborRate";
import { DEFAULT_SETTINGS } from "./settings";
import type { JobEvidence, LaborEntryRef, MonthEvidence } from "./types";

/**
 * The cases here are the REAL Berger Bunkhouse August 2026 month, reduced.
 * That month was out by $1,096.75 against the tracking sheet and took a hand
 * reconciliation to explain: two people's entries were stranded at $65 after a
 * raise to $75, and one pay type carried two rates at once. Both are here.
 */

const CONFIG = DEFAULT_SETTINGS.checks["labor-rate"].config as LaborRateConfig;

function entry(over: Partial<LaborEntryRef> = {}): LaborEntryRef {
  return {
    id: "t1",
    employee: "Eric Johnson",
    payType: "Regular Pay",
    rate: 65,
    hours: 8,
    cost: 520,
    code: "07 46 23",
    day: "2026-08-04",
    ...over,
  };
}

function job(labor: LaborEntryRef[]): JobEvidence {
  return {
    jobId: "J1",
    jobName: "Bunkhouse",
    customerName: "Kevin Berger",
    neverInvoiced: false,
    invoices: [],
    bills: [],
    folder: null,
    uninvoicedBillsCost: 0,
    uninvoicedTimeCost: 0,
    draftBillsCost: 0,
    draftBillCount: 0,
    labor,
  };
}

/** A rate card: employee → pay type → the rate it carries today. */
function card(rows: [string, string, number][]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const [who, type, rate] of rows) {
    const inner = m.get(who) ?? new Map<string, number>();
    inner.set(type, rate);
    m.set(who, inner);
  }
  return m;
}

function month(laborRates: Map<string, Map<string, number>> | null): MonthEvidence {
  return {
    ym: "2026-08",
    year: 2026,
    month: 8,
    monthLabel: "August 2026",
    folderRoot: "/2026 Invoicing/09 September 26 (August Billing)/",
    jobs: [],
    laborRates,
    emailChecked: false,
    emails: [],
    mailWindow: null,
    mailTruncated: false,
    warnings: [],
  };
}

const run = (labor: LaborEntryRef[], rates: Map<string, Map<string, number>> | null) =>
  laborRateCheck.run({
    job: job(labor),
    month: month(rates),
    config: CONFIG,
    global: DEFAULT_SETTINGS.global,
  });

describe("laborRateCheck", () => {
  it("says nothing when every entry matches the current rate", () => {
    const out = run(
      [entry({ rate: 75, cost: 600 }), entry({ id: "t2", rate: 75, cost: 600 })],
      card([["Eric Johnson", "Regular Pay", 75]]),
    );
    expect(out).toEqual([]);
  });

  // The Eric/Wyatt case: a raise applied after the entries were written.
  it("flags a whole month stranded at the old rate", () => {
    const out = run(
      [
        entry({ id: "a", rate: 65, hours: 40, cost: 2600 }),
        entry({ id: "b", rate: 65, hours: 48.97, cost: 3183.05 }),
      ],
      card([["Eric Johnson", "Regular Pay", 75]]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("labor-rate-stale");
    expect(out[0].severity).toBe("warning");
    // 88.97h × $10 of rate difference.
    expect(out[0].amount).toBeCloseTo(889.7, 2);
    expect(out[0].title).toContain("$65/hr");
    expect(out[0].title).toContain("$75/hr");
    expect(out[0].detail).toContain("under");
  });

  // The Seth case: one pay type carrying two rates inside one month.
  it("flags one pay type costed at two different rates", () => {
    const out = run(
      [
        entry({ id: "a", employee: "Seth June", rate: 75, hours: 24.72, cost: 1854 }),
        entry({ id: "b", employee: "Seth June", rate: 85, hours: 15.25, cost: 1296.25 }),
      ],
      card([["Seth June", "Regular Pay", 75]]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("labor-rate-split");
    expect(out[0].title).toContain("2 different rates");
    expect(out[0].detail).toContain("24.7h at $75/hr");
    expect(out[0].detail).toContain("15.3h at $85/hr");
    // 39.97h at the current $75 is 2997.75 against 3150.25 recorded.
    expect(out[0].amount).toBeCloseTo(152.5, 2);
  });

  it("reports a split once, not also as stale", () => {
    const out = run(
      [
        entry({ id: "a", rate: 65, hours: 40, cost: 2600 }),
        entry({ id: "b", rate: 75, hours: 40, cost: 3000 }),
      ],
      card([["Eric Johnson", "Regular Pay", 75]]),
    );
    expect(out.map((f) => f.kind)).toEqual(["labor-rate-split"]);
  });

  it("flags a pay type that is gone from the membership", () => {
    const out = run(
      [entry({ payType: "Berger - Lead Carpenter", rate: 85, hours: 10, cost: 850 })],
      card([["Eric Johnson", "Regular Pay", 75]]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("labor-rate-unknown");
    expect(out[0].detail).toContain("renamed or removed");
  });

  it("holds its tongue when the pay type is gone and the office turned that off", () => {
    const out = laborRateCheck.run({
      job: job([entry({ payType: "Gone", rate: 85, hours: 10, cost: 850 })]),
      month: month(card([["Eric Johnson", "Regular Pay", 75]])),
      config: { ...CONFIG, reportUnknownTypes: false },
      global: DEFAULT_SETTINGS.global,
    });
    expect(out).toEqual([]);
  });

  it("ignores a variance under the floor", () => {
    // 0.25h at a 1-cent rate difference is worth a quarter of a cent.
    const out = run(
      [entry({ rate: 74.99, hours: 0.25, cost: 18.75 })],
      card([["Eric Johnson", "Regular Pay", 75]]),
    );
    expect(out).toEqual([]);
  });

  it("ignores paid leave, which JobTread carries at $0 by design", () => {
    const out = run(
      [entry({ payType: "Paid time off", rate: 0, hours: 8, cost: 0 })],
      card([["Eric Johnson", "Regular Pay", 75]]),
    );
    expect(out).toEqual([]);
  });

  // A check with no reference must be SKIPPED, never silently passed.
  it("says nothing at all when the grant could not read the rate card", () => {
    const out = run([entry({ rate: 65, hours: 88.97, cost: 5783.05 })], null);
    expect(out).toEqual([]);
  });

  it("says nothing on a job with no labor", () => {
    expect(run([], card([["Eric Johnson", "Regular Pay", 75]]))).toEqual([]);
  });

  it("reports the biggest money first", () => {
    const out = run(
      [
        entry({ id: "a", employee: "Wyatt Weisman", rate: 65, hours: 32.55, cost: 2115.75 }),
        entry({ id: "b", employee: "Eric Johnson", rate: 65, hours: 88.97, cost: 5783.05 }),
      ],
      card([
        ["Wyatt Weisman", "Regular Pay", 75],
        ["Eric Johnson", "Regular Pay", 75],
      ]),
    );
    expect(out.map((f) => f.jobName)).toHaveLength(2);
    expect(out[0].title).toContain("Eric Johnson");
    expect(out[1].title).toContain("Wyatt Weisman");
  });
});
