/**
 * THE QUICKBOOKS HANDOFF CHECK — and, mostly, the bills it must NOT report.
 *
 * This check is the first one in the review that asks about Ascent's own books
 * rather than about the client. That makes its false positives expensive in a
 * new way: a bill excluded from QuickBooks on purpose, reported every month,
 * would train the office to skim past a finding whose whole value is that it is
 * rare. So most of what is pinned here is silence.
 */
import { describe, expect, it } from "vitest";

import { qboPushCheck } from "./checks/qboPush";
import { DEFAULT_SETTINGS } from "./settings";
import type { BillRef, JobEvidence, MonthEvidence } from "./types";

const CONFIG = DEFAULT_SETTINGS.checks["qbo-push"].config;
const GLOBAL = DEFAULT_SETTINGS.global;

function bill(over: Partial<BillRef> & { id: string }): BillRef {
  return {
    label: "INV-4471",
    vendor: "Sunset Builders Supply",
    cost: 1200,
    status: "approved",
    invoiced: true,
    invoiceIds: ["inv-1"],
    sentInvoiceIds: ["inv-1"],
    issueDate: "2026-07-31",
    lineCount: 1,
    qboIsIgnored: false,
    ...over,
  };
}

function job(bills: BillRef[], over: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1",
    jobName: "Main House",
    customerName: "Kevin Berger",
    neverInvoiced: false,
    invoices: [],
    bills,
    folder: null,
    uninvoicedBillsCost: 0,
    uninvoicedTimeCost: 0,
    draftBillsCost: 0,
    draftBillCount: 0,
    draftBills: [],
    labor: [],
    ...over,
  };
}

const MONTH: MonthEvidence = {
  ym: "2026-07",
  year: 2026,
  month: 7,
  monthLabel: "July 2026",
  folderRoot: "/2026 Invoicing/08 August 26 (July Billing)/",
  jobs: [],
  emailChecked: true,
  emails: [],
  warnings: [],
} as unknown as MonthEvidence;

const run = (j: JobEvidence, config = CONFIG) =>
  qboPushCheck.run({ config, global: GLOBAL, month: MONTH, job: j });

describe("qbo-push — the flag", () => {
  it("reports an approved bill flagged not to push", () => {
    const found = run(job([bill({ id: "b1", qboIsIgnored: true })]));
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("qbo-not-pushed");
    expect(found[0].amount).toBe(1200);
  });

  it("calls it an error, because the revenue lands and the cost does not", () => {
    // Severity matters here: this is not "worth a look", it is a hole in the
    // month's profit figure of exactly the bill's amount.
    const found = run(job([bill({ id: "b1", qboIsIgnored: true })]));
    expect(found[0].severity).toBe("error");
  });

  it("says the client has already been invoiced when they have", () => {
    const invoiced = run(job([bill({ id: "b1", qboIsIgnored: true, invoiced: true })]));
    expect(invoiced[0].detail).toContain("client HAS been invoiced");
    const not = run(job([bill({ id: "b1", qboIsIgnored: true, invoiced: false })]));
    expect(not[0].detail).toContain("costs nothing");
  });

  it("says nothing about a bill that will push", () => {
    expect(run(job([bill({ id: "b1", qboIsIgnored: false })]))).toHaveLength(0);
  });

  it("SKIPS a bill whose flag could not be read", () => {
    // null is "we could not see it". Reporting it would be a guess, and a guess
    // that names a dollar figure is worse than no finding.
    expect(run(job([bill({ id: "b1", qboIsIgnored: null })]))).toHaveLength(0);
  });

  it("ignores a bill under the floor", () => {
    // A near-zero item kept out of QuickBooks is housekeeping.
    expect(run(job([bill({ id: "b1", cost: 0, qboIsIgnored: true })]))).toHaveLength(0);
  });

  it("reports at most one finding per bill", () => {
    // A flagged bill that is also pending is one problem with one fix; two rows
    // for it would double-count the money at stake.
    const found = run(
      job([bill({ id: "b1", qboIsIgnored: true, status: "pending", invoiceIds: ["inv-1"] })]),
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("qbo-not-pushed");
  });
});

describe("qbo-push — never approved", () => {
  it("reports a pending bill that is already on a SENT client invoice", () => {
    const found = run(job([bill({ id: "b1", status: "pending", sentInvoiceIds: ["inv-1"] })]));
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("qbo-never-approved");
  });

  it("says nothing about a pending bill that has not been invoiced", () => {
    // Pending and unbilled is ordinary work in progress — the coding queue's
    // normal state, and draft-bills already speaks for what is left behind.
    expect(
      run(job([bill({ id: "b1", status: "pending", invoiceIds: [], sentInvoiceIds: [] })])),
    ).toHaveLength(0);
  });

  it("says nothing about a bill whose ONLY invoice is still a draft", () => {
    // Berger Main House, August 2026: Island Custom Woodworks sat on invoice
    // #12 while #12 was a draft, and this check reported "invoiced but never
    // approved" — but the client had not been billed for anything yet, since
    // nothing had been sent. `invoiceIds` (any status, draft included) is
    // nonempty here on purpose — the bill IS on an invoice record — but
    // `sentInvoiceIds` is empty, because that invoice has not gone out, and
    // that is the field this finding must key off.
    const found = run(
      job([bill({ id: "b1", status: "pending", invoiceIds: ["inv-1"], sentInvoiceIds: [] })]),
    );
    expect(found).toHaveLength(0);
  });

  it("fires once the invoice leaves draft", () => {
    const found = run(
      job([bill({ id: "b1", status: "pending", invoiceIds: ["inv-1"], sentInvoiceIds: ["inv-1"] })]),
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("qbo-never-approved");
  });

  it("says nothing about an approved bill on an invoice", () => {
    expect(
      run(job([bill({ id: "b1", status: "approved", sentInvoiceIds: ["inv-1"] })])),
    ).toHaveLength(0);
  });

  it("can be turned off without disabling the flag finding", () => {
    const config = { ...CONFIG, reportNeverApproved: false };
    expect(
      run(job([bill({ id: "b1", status: "pending", sentInvoiceIds: ["inv-1"] })]), config),
    ).toHaveLength(0);
    expect(run(job([bill({ id: "b1", qboIsIgnored: true })]), config)).toHaveLength(1);
  });
});

describe("qbo-push — scope", () => {
  it("still checks an overhead job", () => {
    // Unlike every invoicing check, this one does NOT skip Office and Shop. That
    // cost is never billed to a client, but it absolutely belongs in the books.
    const found = run(
      job([bill({ id: "b1", qboIsIgnored: true, invoiced: false })], {
        neverInvoiced: true,
        jobName: "Shop",
        customerName: "Ascent Building Co.",
      }),
    );
    expect(found).toHaveLength(1);
  });

  it("gives each bill its own stable key, so a ruling suppresses one bill", () => {
    const found = run(
      job([
        bill({ id: "b1", qboIsIgnored: true }),
        bill({ id: "b2", qboIsIgnored: true, vendor: "Island Custom Woodworks" }),
      ]),
    );
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.key)).size).toBe(2);
  });

  it("links each finding to its own bill", () => {
    const found = run(job([bill({ id: "b-9f2", qboIsIgnored: true })]));
    expect(found[0].sourceLink).toBe("/bill/b-9f2");
  });
});
