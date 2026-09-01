/**
 * The margin checks. For a cost-plus builder these are the ones that matter
 * most — the markup IS the revenue — and they are also the ones most able to
 * flood the review, because JobTread records 0 cost for every flat-priced line
 * and a naive check would call all of them "billed at cost".
 *
 * So most of what is pinned here is the SILENCE.
 */
import { describe, expect, it } from "vitest";

import { marginCheck, type MarginConfig } from "./checks/margin";
import { markupDriftCheck } from "./checks/markupDrift";
import { DEFAULT_SETTINGS } from "./settings";
import { customerKey } from "./norms";
import type {
  CustomerNorm,
  InvoiceEvidence,
  InvoiceLine,
  JobEvidence,
  MonthEvidence,
  ReviewNorms,
} from "./types";

const GLOBAL = DEFAULT_SETTINGS.global;
const MARGIN = DEFAULT_SETTINGS.checks.margin.config;
const DRIFT = DEFAULT_SETTINGS.checks["markup-drift"].config;

function line(partial: Partial<InvoiceLine> & { id: string }): InvoiceLine {
  return {
    name: "Framing lumber", description: "", code: "06 11 00", codeName: "Wood Framing",
    quantity: 0, unitCost: 0, unitPrice: 0, cost: 0, price: 0, isTaxable: true,
    ...partial,
  };
}

function invoice(lines: InvoiceLine[], over: Partial<InvoiceEvidence> = {}): InvoiceEvidence {
  return {
    id: "i1", number: "100", name: "July billing", status: "approved",
    issueDate: "2026-07-31", dueDate: "2026-08-30",
    cost: 0, price: 0, priceWithTax: 0, tax: 0, taxRate: 0, amountPaid: 0, balance: 0,
    lines, billIds: [], jtUrl: "https://app.jobtread.com/x",
    ...over,
  };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1", jobName: "Otis Perkins Addition", customerName: "Ferron",
    neverInvoiced: false, invoices: [], bills: [],
    folder: { path: "/x/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
    ...partial,
  };
}

function month(jobs: JobEvidence[], norms?: ReviewNorms): MonthEvidence {
  return {
    ym: "2026-07", year: 2026, month: 7, monthLabel: "July 2026",
    folderRoot: "/x/", jobs,
    emailChecked: false, emails: [], mailWindow: null, mailTruncated: false, warnings: [],
    ...(norms ? { norms } : {}),
  };
}

/** Run the line-level margin check over one invoice. */
function margin(lines: InvoiceLine[], config: MarginConfig = MARGIN) {
  const j = job();
  return marginCheck
    .run({ config, global: GLOBAL, month: month([j]), job: j, invoice: invoice(lines) })
    .map((f) => f.kind);
}

describe("markup-missing", () => {
  it("flags a line billed at exactly its cost", () => {
    expect(margin([line({ id: "l1", cost: 1000, price: 1000 })])).toEqual(["markup-missing"]);
  });

  it("says nothing about a line with markup on it", () => {
    expect(margin([line({ id: "l1", cost: 1000, price: 1220 })])).toEqual([]);
  });

  it("says nothing when NO COST is recorded", () => {
    // The flood case. JobTread holds 0 for a flat-priced line, a deposit, an
    // allowance draw — reading that as "billed at zero cost" would fire this on
    // most lines of most invoices and get the whole review ignored.
    expect(margin([line({ id: "l1", cost: 0, price: 5000 })])).toEqual([]);
  });

  it("says nothing about a line under the floor", () => {
    expect(margin([line({ id: "l1", cost: 10, price: 10 })])).toEqual([]);
  });

  it("says nothing about a credit, where markup is a different question", () => {
    expect(margin([line({ id: "l1", cost: -300, price: -300 })])).toEqual([]);
  });

  it("skips a cost code the office bills at cost on purpose", () => {
    const cfg = { ...MARGIN, passThroughCodes: ["01 41"] };
    const permit = line({ id: "l1", code: "01 41 26", name: "Building permit", cost: 900, price: 900 });
    expect(margin([permit])).toEqual(["markup-missing"]); // without the list
    expect(margin([permit], cfg)).toEqual([]); // with it
  });

  it("matches a pass-through code as a PREFIX, not a whole string", () => {
    const cfg = { ...MARGIN, passThroughCodes: ["01"] };
    expect(margin([line({ id: "l1", code: "01 41 26", cost: 900, price: 900 })], cfg)).toEqual([]);
  });

  it("does not let an empty pass-through list match everything", () => {
    // A "" prefix would startsWith-match every code. The guard is worth a test
    // because the failure is silent: the check would simply stop working.
    const cfg = { ...MARGIN, passThroughCodes: ["", "  "] };
    expect(margin([line({ id: "l1", cost: 900, price: 900 })], cfg)).toEqual(["markup-missing"]);
  });
});

describe("billed-below-cost", () => {
  it("flags a line billed for less than it cost", () => {
    expect(margin([line({ id: "l1", cost: 1000, price: 800 })])).toEqual(["billed-below-cost"]);
  });

  it("reports it ONCE, not also as missing markup", () => {
    const f = marginCheck.run({
      config: MARGIN, global: GLOBAL,
      month: month([job()]), job: job(), invoice: invoice([line({ id: "l1", cost: 1000, price: 800 })]),
    });
    expect(f).toHaveLength(1);
  });

  it("shows what the shortfall is worth", () => {
    const f = marginCheck.run({
      config: MARGIN, global: GLOBAL,
      month: month([job()]), job: job(), invoice: invoice([line({ id: "l1", cost: 1000, price: 800 })]),
    });
    expect(f[0].amount).toBe(200);
  });

  it("does not fire on a rounding-sized difference", () => {
    expect(margin([line({ id: "l1", cost: 1000, price: 999.995 })])).toEqual(["markup-missing"]);
  });
});

describe("markup-rate-drift", () => {
  function norms(customers: CustomerNorm[]): ReviewNorms {
    return { ym: "2026-07", windowMonths: 12, monthsOfHistory: 10, vendors: [], customers };
  }
  function ferron(partial: Partial<CustomerNorm> = {}): CustomerNorm {
    return {
      key: customerKey("Ferron"), name: "Ferron",
      monthsSeen: 9, monthsOfHistory: 10,
      typicalMarkup: 1.22, typicalMonthlyPrice: 60000,
      ...partial,
    };
  }
  /** A month billing Ferron `price` on `cost`. */
  const billed = (cost: number, price: number, n?: ReviewNorms) =>
    month([job({ invoices: [invoice([], { cost, price })] })], n);

  const run = (m: MonthEvidence) =>
    markupDriftCheck.run({ config: DRIFT, global: GLOBAL, month: m }).map((f) => f.title);

  it("says nothing without norms — no baseline is NO signal", () => {
    expect(run(billed(50000, 61000))).toEqual([]);
  });

  it("says nothing when the rate matches their usual", () => {
    expect(run(billed(50000, 61000, norms([ferron()])))).toEqual([]); // 1.22
  });

  it("flags a customer billed well under their usual rate", () => {
    // 50k cost at 1.10 = 55,000, where 1.22 would have been 61,000.
    expect(run(billed(50000, 55000, norms([ferron()])))).toEqual([
      "Ferron billed at 10.0%, usually 22.0%",
    ]);
  });

  it("flags OVER-billing too — that is the one the client notices", () => {
    expect(run(billed(50000, 70000, norms([ferron()])))).toHaveLength(1);
  });

  it("says the shortfall in dollars, which is what makes it actionable", () => {
    const f = markupDriftCheck.run({
      config: DRIFT, global: GLOBAL, month: billed(50000, 55000, norms([ferron()])),
    });
    expect(f[0].amount).toBe(6000);
    expect(f[0].detail).toContain("$6,000.00");
  });

  it("says nothing when the customer has too little history", () => {
    expect(run(billed(50000, 55000, norms([ferron({ monthsSeen: 2 })])))).toEqual([]);
  });

  it("says nothing on a month too small to draw a rate from", () => {
    // 500 of cost can swing wildly for innocent reasons.
    expect(run(billed(500, 300, norms([ferron()])))).toEqual([]);
  });

  it("says nothing when the gap is real but not worth money", () => {
    // 4 points off, but on a small enough base that it is under $500.
    expect(run(billed(3000, 3780, norms([ferron()])))).toEqual([]);
  });

  it("reports ONCE for a customer with several jobs", () => {
    // The reason this check is month-scoped. Per job it would emit three
    // identical findings for one rate.
    const m = month(
      [
        job({ jobId: "J1", invoices: [invoice([], { cost: 20000, price: 22000 })] }),
        job({ jobId: "J2", invoices: [invoice([], { cost: 20000, price: 22000 })] }),
        job({ jobId: "J3", invoices: [invoice([], { cost: 10000, price: 11000 })] }),
      ],
      norms([ferron()]),
    );
    expect(run(m)).toHaveLength(1);
  });

  it("ignores Ascent's own overhead jobs, which are never billed to anyone", () => {
    const m = month(
      [job({ jobName: "Office", neverInvoiced: true, invoices: [invoice([], { cost: 50000, price: 50000 })] })],
      norms([ferron()]),
    );
    expect(run(m)).toEqual([]);
  });
});
