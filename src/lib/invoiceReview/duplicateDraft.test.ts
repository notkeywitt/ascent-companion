import { describe, expect, it } from "vitest";
import { duplicateDraftCheck, type DuplicateDraftConfig } from "./checks/duplicateDraft";
import { DEFAULT_SETTINGS } from "./settings";
import type { BillRef, JobEvidence, MonthEvidence } from "./types";

/**
 * Built from Kevin Berger / Main House, August 2026: two drafts, both Island
 * Custom Woodworks, both $4,163.75, both issued 2026-08-31, created fourteen
 * minutes apart with different externalIds. The pre-send gate reported only
 * "2 bills still in draft — $8,327.50".
 */

const CONFIG = DEFAULT_SETTINGS.checks["duplicate-draft"].config as DuplicateDraftConfig;

function bill(over: Partial<BillRef> = {}): BillRef {
  return {
    id: "b1",
    label: "INV-8e06f037",
    vendor: "Island Custom Woodworks",
    cost: 4163.75,
    status: "draft",
    invoiced: false,
    invoiceIds: [],
    sentInvoiceIds: [],
    issueDate: "2026-08-31",
    lineCount: 1, taxAmount: 0,
    qboIsIgnored: false,
    ...over,
  };
}

function job(draftBills: BillRef[], bills: BillRef[] = []): JobEvidence {
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
    draftBillCount: draftBills.length,
    draftBills,
    labor: [],
  };
}

const month = {
  ym: "2026-08",
  year: 2026,
  month: 8,
  monthLabel: "August 2026",
  folderRoot: "/x/",
  jobs: [],
  laborRates: null,
  emailChecked: false,
  emails: [],
  mailWindow: null,
  mailTruncated: false,
  warnings: [],
} satisfies MonthEvidence;

const run = (drafts: BillRef[], finalized: BillRef[] = [], config = CONFIG) =>
  duplicateDraftCheck.run({ job: job(drafts, finalized), month, config, global: DEFAULT_SETTINGS.global });

describe("duplicateDraftCheck", () => {
  it("catches the two Main House drafts and prices only the surplus", () => {
    const out = run([bill(), bill({ id: "b2", label: "INV-c1d0facc" })]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("bill-duplicate-draft");
    expect(out[0].severity).toBe("error");
    // The DUPLICATE cost, not the $8,327.50 both together.
    expect(out[0].amount).toBeCloseTo(4163.75, 2);
    expect(out[0].title).toContain("×2");
    expect(out[0].detail).toContain("2 in draft");
    expect(out[0].detail).toContain("INV-8e06f037, INV-c1d0facc");
  });

  it("catches a draft twinning an already-finalized bill", () => {
    const out = run([bill()], [bill({ id: "b2", label: "#41", status: "approved" })]);
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain("1 in draft");
    expect(out[0].detail).toContain("1 already finalized (approved)");
  });

  it("leaves two finalized bills alone — not this check's question", () => {
    const out = run([], [bill({ status: "approved" }), bill({ id: "b2", status: "approved" })]);
    expect(out).toEqual([]);
  });

  it("does not pair bills issued on different dates", () => {
    const out = run([bill(), bill({ id: "b2", issueDate: "2026-08-12" })]);
    expect(out).toEqual([]);
  });

  it("pairs them anyway when the office turns the date rule off", () => {
    const out = run([bill(), bill({ id: "b2", issueDate: "2026-08-12" })], [], {
      ...CONFIG,
      requireSameIssueDate: false,
    });
    expect(out).toHaveLength(1);
  });

  it("does not pair different vendors or different amounts", () => {
    expect(run([bill(), bill({ id: "b2", vendor: "Sunset Building Supply" })])).toEqual([]);
    expect(run([bill(), bill({ id: "b2", cost: 4163.76 })])).toEqual([]);
  });

  it("matches vendor names that differ only in case and spacing", () => {
    const out = run([bill(), bill({ id: "b2", vendor: "island custom  woodworks" })]);
    expect(out).toHaveLength(1);
  });

  it("ignores empty shell drafts", () => {
    expect(run([bill({ cost: 0 }), bill({ id: "b2", cost: 0 })])).toEqual([]);
  });

  it("counts a third copy into the surplus", () => {
    const out = run([bill(), bill({ id: "b2" }), bill({ id: "b3" })]);
    expect(out[0].amount).toBeCloseTo(8327.5, 2);
    expect(out[0].title).toContain("×3");
  });

  it("says nothing when the job has no drafts", () => {
    expect(run([])).toEqual([]);
  });

  it("keys the finding on the group, so deleting a copy retires it", () => {
    const [a] = run([bill(), bill({ id: "b2" })]);
    const [b] = run([bill({ id: "b9", label: "other-id" }), bill({ id: "b2" })]);
    expect(a.key).toBe(b.key);
  });
});
