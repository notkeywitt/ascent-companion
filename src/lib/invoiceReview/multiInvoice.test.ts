/**
 * A job billed on more than one invoice in a month. Berger Bunkhouse, October
 * 2026: #473 is the monthly invoice with P&O, #416 passes the Preferred
 * Plumbing fixtures through at cost ($21,795 cost and price).
 */
import { describe, expect, it } from "vitest";

import { marginCheck } from "./checks/margin";
import { markupDriftCheck } from "./checks/markupDrift";
import { monthInvoicesCheck } from "./checks/monthInvoices";
import { isAtCostInvoice } from "./checks/shared";
import { customerKey } from "./norms";
import { DEFAULT_SETTINGS } from "./settings";
import type {
  BillRef,
  InvoiceEvidence,
  InvoiceLine,
  JobEvidence,
  LaborEntryRef,
  MonthEvidence,
  ReviewNorms,
} from "./types";

const GLOBAL = DEFAULT_SETTINGS.global;
const MARGIN = DEFAULT_SETTINGS.checks.margin.config;
const MONTH_INV = DEFAULT_SETTINGS.checks["month-invoices"].config;
const DRIFT = DEFAULT_SETTINGS.checks["markup-drift"].config;

function line(id: string, cost: number, price: number, code = "22 20 00"): InvoiceLine {
  return {
    id, name: `Line ${id}`, description: "", code, codeName: "",
    quantity: 1, unitCost: cost, unitPrice: price, cost, price, isTaxable: true,
  };
}

function invoice(id: string, number: string, lines: InvoiceLine[], over: Partial<InvoiceEvidence> = {}): InvoiceEvidence {
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const price = lines.reduce((s, l) => s + l.price, 0);
  return {
    id, number, name: "Invoice", status: "pending",
    issueDate: "2026-10-31", dueDate: "2026-11-30",
    cost, price, priceWithTax: price, tax: 0, taxRate: 0, amountPaid: 0, balance: price,
    lines, billIds: [], jtUrl: `https://app.jobtread.com/x/${id}`,
    ...over,
  };
}

function bill(id: string, cost: number, invoiceIds: string[], taxAmount = 0): BillRef {
  return {
    id, label: id, vendor: `Vendor ${id}`, cost, lineCount: 1, taxAmount,
    untaxedLineCount: 0, untaxedCost: 0, status: "approved",
    invoiceIds, sentInvoiceIds: invoiceIds, invoiced: invoiceIds.length > 0,
    issueDate: "2026-10-31", qboIsIgnored: false,
  };
}

function time(id: string, cost: number, invoiceIds: string[]): LaborEntryRef {
  return {
    id, employee: "Ty", payType: "Regular Pay", rate: 75, hours: cost / 75, cost,
    code: "06 10 00", day: "2026-10-15", invoiceIds,
  };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1", jobName: "Bunkhouse", customerName: "Berger",
    neverInvoiced: false, invoices: [], bills: [],
    folder: null,
    uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
    draftBills: [], labor: [],
    ...partial,
  };
}

function month(jobs: JobEvidence[], norms?: ReviewNorms): MonthEvidence {
  return {
    ym: "2026-10", year: 2026, month: 10, monthLabel: "October 2026",
    folderRoot: "/x/", jobs,
    emailChecked: false, emails: [], mailWindow: null, mailTruncated: false,
    laborRates: null, warnings: [],
    ...(norms ? { norms } : {}),
  };
}

const fixtures = () => invoice("i416", "416", [line("a", 9800, 9800), line("b", 11995, 11995)]);
const monthly = () =>
  invoice("i473", "473", [line("c", 60000, 72000, "06 10 00"), line("d", 22488.52, 27547.01, "06 10 00")]);

describe("isAtCostInvoice", () => {
  it("is true when every work line is billed at its cost", () => {
    expect(isAtCostInvoice(fixtures())).toBe(true);
    expect(isAtCostInvoice(monthly())).toBe(false);
  });
  it("is false for a flat-priced line with no cost, and for an empty invoice", () => {
    expect(isAtCostInvoice(invoice("x", "1", [line("a", 0, 500)]))).toBe(false);
    expect(isAtCostInvoice(invoice("x", "1", []))).toBe(false);
  });
  it("ignores deposit lines", () => {
    expect(isAtCostInvoice(invoice("x", "1", [line("a", 100, 100), line("d", -500, -500, "CD")]))).toBe(true);
  });
});

describe("margin on a month with two invoices", () => {
  const run = (inv: InvoiceEvidence, j: JobEvidence) =>
    marginCheck.run({ config: MARGIN, global: GLOBAL, month: month([j]), job: j, invoice: inv });

  it("reads a materials invoice at cost beside the monthly one as one info note", () => {
    const j = job({ invoices: [monthly(), fixtures()] });
    const out = run(j.invoices[1], j);
    expect(out.map((f) => [f.kind, f.severity])).toEqual([["invoice-at-cost", "info"]]);
    expect(out[0].title).toContain("#416");
    expect(out[0].detail).toContain("#473");
  });

  it("still judges an at-cost invoice line by line when it is the job's only one", () => {
    const j = job({ invoices: [fixtures()] });
    expect(run(j.invoices[0], j).map((f) => f.kind)).toEqual(["markup-missing", "markup-missing"]);
  });

  it("does not count a void invoice as the marked-up one", () => {
    const j = job({ invoices: [monthly(), fixtures()].map((i, k) => (k === 0 ? { ...i, status: "denied" } : i)) });
    expect(run(j.invoices[1], j).map((f) => f.kind)).toEqual(["markup-missing", "markup-missing"]);
  });
});

describe("markup drift leaves the at-cost invoice out", () => {
  it("measures the customer's rate on the marked-up invoice alone", () => {
    const m = month([job({ invoices: [monthly(), fixtures()] })], {
      ym: "2026-10", windowMonths: 6, monthsOfHistory: 6, vendors: [],
      customers: [
        {
          key: customerKey("Berger"), name: "Berger", monthsSeen: 6, monthsOfHistory: 6,
          typicalMarkup: 99547.01 / 82488.52, typicalMonthlyPrice: 99547.01,
        },
      ],
    });
    expect(markupDriftCheck.run({ config: DRIFT, global: GLOBAL, month: m })).toEqual([]);
  });
});

describe("month-invoices", () => {
  const run = (j: JobEvidence) =>
    monthInvoicesCheck.run({ config: MONTH_INV, global: GLOBAL, month: month([j]), job: j });

  it("is quiet when the bills and time on both invoices add up to their cost", () => {
    const j = job({
      invoices: [monthly(), fixtures()],
      bills: [bill("pp", 21795, ["i416"]), bill("lumber", 60000, ["i473"])],
      labor: [time("t1", 22488.52, ["i473"])],
    });
    expect(run(j)).toEqual([]);
  });

  it("is quiet when one bill's lines are split across the two invoices", () => {
    const j = job({
      invoices: [monthly(), fixtures()],
      bills: [bill("big", 81795, ["i416", "i473"])],
      labor: [time("t1", 22488.52, ["i473"])],
    });
    expect(run(j)).toEqual([]);
  });

  it("accepts the bill's sales tax left off the invoice", () => {
    const j = job({
      invoices: [fixtures()],
      bills: [bill("pp", 21795 + 1800, ["i416"], 1800)],
    });
    expect(run(j)).toEqual([]);
  });

  it("reports invoices that carry more cost than the month's bills and time on them", () => {
    const j = job({
      invoices: [monthly(), fixtures()],
      bills: [bill("pp", 21795, ["i416"]), bill("lumber", 60000, ["i473"])],
      labor: [time("t1", 20000, ["i473"])],
    });
    const out = run(j);
    expect(out.map((f) => f.kind)).toEqual(["month-invoices-gap"]);
    expect(out[0].amount).toBeCloseTo(2488.52, 2);
    expect(out[0].title).toContain("2 invoices");
    expect(out[0].detail).toContain("#416 at cost");
  });

  it("reports invoices that carry less, and names what is on no invoice", () => {
    const j = job({
      invoices: [fixtures()],
      bills: [bill("pp", 25000, ["i416"]), bill("late", 400, [])],
    });
    const out = run(j);
    expect(out[0].title).toContain("less");
    expect(out[0].amount).toBeCloseTo(3205, 2);
    expect(out[0].detail).toContain("$400.00 is on no invoice");
  });

  it("says nothing on a job with no live invoice", () => {
    expect(run(job({ bills: [bill("pp", 100, [])] }))).toEqual([]);
  });
});
