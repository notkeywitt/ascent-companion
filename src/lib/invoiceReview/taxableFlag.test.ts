/**
 * THE STRAY isTaxable FLAG — and, mostly, the bills it must NOT report.
 *
 * The one real case is pinned from Ferron / Otis Perkins Addition, August 2026.
 * Everything else here is silence: a wholly exempt bill is a decision, and a
 * check that argues with a decision every month is a check the office learns
 * to skim.
 */
import { describe, expect, it } from "vitest";

import { taxableFlagCheck } from "./checks/taxableFlag";
import { DEFAULT_SETTINGS } from "./settings";
import type { BillRef, InvoiceEvidence, JobEvidence, MonthEvidence } from "./types";

const CONFIG = DEFAULT_SETTINGS.checks["taxable-flag"].config;
const GLOBAL = DEFAULT_SETTINGS.global;

function bill(over: Partial<BillRef> & { id: string }): BillRef {
  return {
    label: "INV-1",
    vendor: "Element Smart Roofing",
    cost: 25083.75,
    status: "approved",
    invoiced: true,
    invoiceIds: ["inv-1"],
    sentInvoiceIds: ["inv-1"],
    issueDate: "2026-08-31",
    lineCount: 13,
    taxAmount: 0,
    untaxedLineCount: 0,
    untaxedCost: 0,
    qboIsIgnored: false,
    ...over,
  };
}

function invoice(over: Partial<InvoiceEvidence> = {}): InvoiceEvidence {
  return {
    id: "inv-1",
    number: "382",
    name: "August billing",
    status: "draft",
    issueDate: "",
    dueDate: "",
    cost: 132597.87,
    price: 156464.9,
    priceWithTax: 169120.2,
    tax: 12655.3,
    taxRate: 0.0835,
    amountPaid: 0,
    balance: 0,
    lines: [],
    billIds: ["b1"],
    jtUrl: "https://app.jobtread.com/x",
    ...over,
  };
}

function job(bills: BillRef[], invoices: InvoiceEvidence[] = [invoice()]): JobEvidence {
  return {
    jobId: "J1",
    jobName: "Otis Perkins Addition",
    customerName: "Ferron",
    neverInvoiced: false,
    invoices,
    bills,
    folder: null,
    uninvoicedBillsCost: 0,
    uninvoicedTimeCost: 0,
    draftBillsCost: 0,
    draftBillCount: 0,
    draftBills: [],
    labor: [],
  };
}

const MONTH: MonthEvidence = {
  ym: "2026-08",
  year: 2026,
  month: 8,
  monthLabel: "August 2026",
  folderRoot: "/2026 Invoicing/09 September 26 (August Billing)/",
  jobs: [],
  emails: [],
  emailChecked: true,
  warnings: [],
  // This check reads only `job`; the rest of the month is scaffolding.
} as unknown as MonthEvidence;

const run = (j: JobEvidence) =>
  taxableFlagCheck.run({ job: j, month: MONTH, config: CONFIG, global: GLOBAL });

describe("taxable-flag", () => {
  it("reports the one line out of step with its siblings", () => {
    const out = run(job([bill({ id: "b1", untaxedLineCount: 1, untaxedCost: 4156.25 })]));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("bill-line-not-taxable");
    expect(out[0].severity).toBe("error");
    // The gap the office actually saw between the sheet and invoice #382 was
    // $410.31 — $409.52 of it this line's tax, the rest per-line rounding.
    // 4,156.25 x 1.18 markup x 0.0835.
    expect(out[0].amount).toBeCloseTo(409.52, 1);
    expect(out[0].title).toContain("1 of 13");
  });

  it("prices the shortfall at the invoice's own rate, not the fallback", () => {
    const withRate = run(job([bill({ id: "b1", untaxedLineCount: 1, untaxedCost: 1000 })]));
    const noRate = run(
      job([bill({ id: "b1", untaxedLineCount: 1, untaxedCost: 1000 })], [invoice({ taxRate: 0.1 })]),
    );
    // 1,000 x 1.18 markup x the rate.
    expect(withRate[0].amount).toBeCloseTo(98.53, 2);
    expect(noRate[0].amount).toBeCloseTo(118, 2);
  });

  it("says nothing about a wholly non-taxable bill — that is a decision", () => {
    expect(run(job([bill({ id: "b1", lineCount: 3, untaxedLineCount: 3, untaxedCost: 9000 })])))
      .toEqual([]);
  });

  it("says nothing about a wholly taxable bill", () => {
    expect(run(job([bill({ id: "b1", untaxedLineCount: 0, untaxedCost: 0 })]))).toEqual([]);
  });

  it("ignores a mixed bill whose exempt lines are trivial", () => {
    expect(run(job([bill({ id: "b1", untaxedLineCount: 1, untaxedCost: 40 })]))).toEqual([]);
  });

  it("stays quiet when the line count could not be read", () => {
    // lineCount 0 means the aggregate failed. "Mixed" is then unanswerable, and
    // guessing would invent a finding on a bill that may be wholly exempt.
    expect(run(job([bill({ id: "b1", lineCount: 0, untaxedLineCount: 1, untaxedCost: 4156.25 })])))
      .toEqual([]);
  });

  it("reports each offending bill once, and only the offenders", () => {
    const out = run(
      job([
        bill({ id: "b1", untaxedLineCount: 1, untaxedCost: 4156.25 }),
        bill({ id: "b2", untaxedLineCount: 0, untaxedCost: 0 }),
        bill({ id: "b3", lineCount: 4, untaxedLineCount: 2, untaxedCost: 2000 }),
      ]),
    );
    expect(out.map((f) => f.key)).toHaveLength(2);
    expect(new Set(out.map((f) => f.key)).size).toBe(2);
  });
});
