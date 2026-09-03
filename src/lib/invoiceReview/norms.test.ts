/**
 * The learned half of the review: the vendor-name key that decides whether two
 * spellings are one supplier, and the check that reasons from a pattern rather
 * than from a document.
 *
 * `vendor-silent` is the first check that could not exist without the run
 * history, so it is also the first that can be wrong in a new way — by nagging
 * about a vendor who was simply quiet. Most of what is pinned here is the
 * SILENCE: the cases where it must say nothing at all.
 */
import { describe, expect, it } from "vitest";

import { vendorSilentCheck } from "./checks/vendorSilent";
import { vendorKey } from "./norms";
import { DEFAULT_SETTINGS } from "./settings";
import type { BillRef, JobEvidence, MonthEvidence, ReviewNorms, VendorNorm } from "./types";

const CONFIG = DEFAULT_SETTINGS.checks["vendor-silent"].config;
const GLOBAL = DEFAULT_SETTINGS.global;

function bill(vendor: string, cost = 100): BillRef {
  return { id: `b-${vendor}`, label: vendor, vendor, cost, status: "approved", invoiced: true, invoiceIds: [], sentInvoiceIds: [], issueDate: "2026-07-15", lineCount: 1, qboIsIgnored: false };
}

function job(bills: BillRef[]): JobEvidence {
  return {
    jobId: "J1", jobName: "Otis Perkins Addition", customerName: "Ferron",
    neverInvoiced: false, invoices: [], bills,
    folder: { path: "/x/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
    draftBills: [],
    labor: [],
  };
}

function norm(partial: Partial<VendorNorm> & { name: string }): VendorNorm {
  return {
    key: vendorKey(partial.name),
    monthsSeen: 10,
    monthsOfHistory: 10,
    typicalMonthlyCost: 4000,
    lastSeenYm: "2026-06",
    ...partial,
  };
}

function month(bills: BillRef[], norms?: ReviewNorms | null): MonthEvidence {
  return {
    ym: "2026-07", year: 2026, month: 7, monthLabel: "July 2026",
    folderRoot: "/2026 Invoicing/08 August 26 (July Billing)/",
    jobs: [job(bills)],
    emailChecked: false, emails: [], mailWindow: null, mailTruncated: false,
    laborRates: null, warnings: [],
    ...(norms ? { norms } : {}),
  };
}

function norms(vendors: VendorNorm[], monthsOfHistory = 10): ReviewNorms {
  return { ym: "2026-07", windowMonths: 12, monthsOfHistory, vendors, customers: [] };
}

const run = (m: MonthEvidence) =>
  vendorSilentCheck.run({ config: CONFIG, global: GLOBAL, month: m }).map((f) => f.title);

describe("vendorKey", () => {
  it("treats the same supplier spelled differently as one vendor", () => {
    // The real reason this exists: three spellings would otherwise look like
    // three vendors each billing a third of the time, which is exactly the
    // shape that turns a real signal into noise.
    const k = vendorKey("Sunset Builders Supply");
    expect(vendorKey("SUNSET BUILDERS SUPPLY LLC")).toBe(k);
    expect(vendorKey("Sunset Builders Supply, Inc.")).toBe(k);
    expect(vendorKey("  sunset   builders  supply  ")).toBe(k);
  });

  it("keeps genuinely different vendors apart", () => {
    expect(vendorKey("Sunset Builders Supply")).not.toBe(vendorKey("Sunrise Electric"));
  });

  it("survives a name that is only noise", () => {
    expect(vendorKey("LLC")).toBe("");
    expect(vendorKey("")).toBe("");
  });
});

describe("vendor-silent says nothing when it has no business speaking", () => {
  it("says nothing without norms — no history is NO signal, not a weak one", () => {
    expect(run(month([]))).toEqual([]);
  });

  it("says nothing when the vendor did bill this month", () => {
    expect(run(month([bill("Sunset Builders Supply")], norms([norm({ name: "Sunset Builders Supply" })])))).toEqual([]);
  });

  it("matches a vendor who billed under a different spelling", () => {
    // The whole point of the key: billing as "SUNSET BUILDERS SUPPLY LLC" must
    // count as Sunset having billed, or the check nags every single month.
    const m = month(
      [bill("SUNSET BUILDERS SUPPLY LLC")],
      norms([norm({ name: "Sunset Builders Supply" })]),
    );
    expect(run(m)).toEqual([]);
  });

  it("says nothing about an occasional vendor", () => {
    const m = month([], norms([norm({ name: "Odd Job Welding", monthsSeen: 4, monthsOfHistory: 10 })]));
    expect(run(m)).toEqual([]); // 4/10 is well under the 0.8 ratio
  });

  it("says nothing about a vendor with too little history, even at a perfect ratio", () => {
    const m = month([], norms([norm({ name: "New Supplier", monthsSeen: 2, monthsOfHistory: 2 })], 2));
    expect(run(m)).toEqual([]);
  });

  it("says nothing about a vendor whose typical month is small change", () => {
    const m = month([], norms([norm({ name: "Corner Hardware", typicalMonthlyCost: 40 })]));
    expect(run(m)).toEqual([]);
  });
});

describe("vendor-silent when it does speak", () => {
  const m = () => month([bill("Someone Else")], norms([norm({ name: "Sunset Builders Supply" })]));

  it("flags a regular, material vendor with nothing this month", () => {
    expect(run(m())).toEqual(["Nothing from Sunset Builders Supply this month"]);
  });

  it("is a warning, never an error — a quiet month is an ordinary thing", () => {
    const f = vendorSilentCheck.run({ config: CONFIG, global: GLOBAL, month: m() });
    expect(f[0].severity).toBe("warning");
  });

  it("shows its working, so the office can judge it", () => {
    const f = vendorSilentCheck.run({ config: CONFIG, global: GLOBAL, month: m() });
    expect(f[0].detail).toContain("10 of the last 10 months");
    expect(f[0].detail).toContain("$4,000.00");
  });

  it("keys on the vendor, so a ruling survives into next month", () => {
    const f = vendorSilentCheck.run({ config: CONFIG, global: GLOBAL, month: m() });
    expect(f[0].key).toBe("vendor-silent||sunset builders supply");
  });
});
