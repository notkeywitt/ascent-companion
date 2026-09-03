/**
 * The pre-send gate's SCOPE RULE.
 *
 * The gate checks one job with evidence loaded for that job alone. Running a
 * month-scoped check against that evidence does not merely waste time — it
 * produces confident, wrong findings, because those checks reason about the
 * whole month by definition. This file pins that they stay out, and that
 * everything else still runs.
 *
 * `preSendCheck` itself needs a live JobTread config, so what is tested here is
 * the pure part it rests on: `runChecks`'s scope filter.
 */
import { describe, expect, it } from "vitest";

import { ALL_CHECKS, runChecks } from "./registry";
import { findingKey } from "./types";
import type { BillRef, InvoiceEvidence, JobEvidence, MonthEvidence, ReviewNorms } from "./types";

function bill(partial: Partial<BillRef> & { id: string; cost: number }): BillRef {
  return { label: partial.id, vendor: "Sunset Builders Supply", status: "approved", invoiced: true, invoiceIds: [], issueDate: '2026-07-15', qboIsIgnored: false, ...partial };
}

function invoice(partial: Partial<InvoiceEvidence> & { id: string }): InvoiceEvidence {
  return {
    number: "100", name: "July billing", status: "approved",
    issueDate: "2026-07-31", dueDate: "2026-08-30",
    cost: 0, price: 0, priceWithTax: 0, tax: 0, taxRate: 0, amountPaid: 0, balance: 0,
    lines: [], billIds: [], jtUrl: "https://app.jobtread.com/x",
    ...partial,
  };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1", jobName: "Otis Perkins Addition", customerName: "Ferron",
    neverInvoiced: false, invoices: [], bills: [],
    folder: { path: "/x/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
    draftBills: [],
    labor: [],
    ...partial,
  };
}

/** One job, with norms present — exactly the shape the pre-send gate builds. */
function oneJobMonth(): MonthEvidence {
  const norms: ReviewNorms = {
    ym: "2026-07", windowMonths: 12, monthsOfHistory: 10,
    // A vendor who bills every month and (in this scoped evidence) appears to
    // have billed nothing — the false positive the scope rule prevents.
    vendors: [
      { key: "reggio register", name: "Reggio Register", monthsSeen: 10, monthsOfHistory: 10, typicalMonthlyCost: 4000, lastSeenYm: "2026-06" },
    ],
    // A customer whose usual markup is 22%, against a job billed at 10% — the
    // other false positive, since the rest of their work is not loaded.
    customers: [
      { key: "ferron", name: "Ferron", monthsSeen: 9, monthsOfHistory: 10, typicalMarkup: 1.22, typicalMonthlyPrice: 60000 },
    ],
  };
  return {
    ym: "2026-07", year: 2026, month: 7, monthLabel: "July 2026",
    folderRoot: "/2026 Invoicing/",
    jobs: [
      job({
        invoices: [invoice({ id: "i1", cost: 50000, price: 55000 })],
        bills: [bill({ id: "b1", cost: 900, invoiced: false })],
      }),
    ],
    emailChecked: false, emails: [], mailWindow: null, mailTruncated: false,
    laborRates: null,
    warnings: [], norms,
  };
}

const kinds = (m: MonthEvidence, scopes?: ReadonlyArray<"job" | "invoice" | "month">) =>
  runChecks(m, undefined, scopes ? { scopes } : {}).map((f) => f.kind);

describe("the scope filter", () => {
  it("runs every scope by default", () => {
    // Sanity: against this evidence the month-scoped checks DO fire, which is
    // exactly why the gate has to exclude them.
    const all = kinds(oneJobMonth());
    expect(all).toContain("vendor-silent");
    expect(all).toContain("markup-rate-drift");
  });

  it("leaves month-scoped checks out for the pre-send gate", () => {
    const gate = kinds(oneJobMonth(), ["job", "invoice"]);
    expect(gate).not.toContain("vendor-silent");
    expect(gate).not.toContain("markup-rate-drift");
  });

  it("runs the labor-rate check, which is job-scoped and belongs in the gate", () => {
    // The rate is snapshotted onto each entry, so a raise applied today leaves
    // the month behind — and the month before it goes out is when that matters.
    expect(ALL_CHECKS.find((c) => c.id === "labor-rate")?.scope).toBe("job");
  });

  it("still runs the job-scoped checks that ARE meaningful for one job", () => {
    // The gate must not go quiet — a real straggler on this job still shows.
    expect(kinds(oneJobMonth(), ["job", "invoice"])).toContain("bill-uninvoiced");
  });

  it("still runs the invoice-scoped checks", () => {
    const m = oneJobMonth();
    // Break the tax so an invoice-scoped check has something to say.
    m.jobs[0].invoices = [invoice({ id: "i1", price: 100, priceWithTax: 100, tax: 5 })];
    expect(kinds(m, ["job", "invoice"])).toContain("math-tax");
  });

  it("can run month-scoped checks alone", () => {
    const only = kinds(oneJobMonth(), ["month"]);
    expect(only).toContain("vendor-silent");
    expect(only).not.toContain("bill-uninvoiced");
  });

  it("an empty scope list runs nothing at all", () => {
    expect(kinds(oneJobMonth(), [])).toEqual([]);
  });

  it("keys findings the same way whatever the scope — so a ruling carries over", () => {
    // A ruling recorded from the pre-send gate must suppress the same finding
    // in the monthly review, and vice versa. Different keys would silently
    // break that.
    const fromGate = runChecks(oneJobMonth(), undefined, { scopes: ["job", "invoice"] })
      .find((f) => f.kind === "bill-uninvoiced");
    expect(fromGate?.key).toBe(findingKey("bill-uninvoiced", "J1", "b1"));
    const fromReview = runChecks(oneJobMonth()).find((f) => f.kind === "bill-uninvoiced");
    expect(fromReview?.key).toBe(fromGate?.key);
  });
});
