/**
 * The registry — the machinery that decides WHICH checks run and what happens
 * when one misbehaves.
 *
 * checks.test.ts covers what each check decides about money. This file covers
 * the things that only became possible once the checks were a registry rather
 * than one function: policy from settings, a check that can be turned off, and
 * a check that throws without taking the whole review down with it.
 */
import { describe, expect, it } from "vitest";

import { ALL_CHECKS, runChecks } from "./registry";
import { DEFAULT_SETTINGS, type InvoiceReviewSettings } from "./settings";
import type { BillRef, InvoiceEvidence, JobEvidence, MonthEvidence } from "./types";

function bill(partial: Partial<BillRef> & { id: string; cost: number }): BillRef {
  return { label: partial.id, vendor: "Vendor", status: "approved", invoiced: true, invoiceIds: [], ...partial };
}

function invoice(partial: Partial<InvoiceEvidence> & { id: string }): InvoiceEvidence {
  return {
    number: "100", name: "July billing", status: "approved",
    issueDate: "2026-07-31", dueDate: "2026-08-30",
    cost: 0, price: 0, priceWithTax: 0, tax: 0, taxRate: 0, amountPaid: 0, balance: 0,
    lines: [], billIds: [],
    jtUrl: "https://app.jobtread.com/jobs/J/documents/" + partial.id,
    ...partial,
  };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1", jobName: "Otis Perkins Addition", customerName: "Ferron",
    neverInvoiced: false, invoices: [], bills: [],
    folder: { path: "/x/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
    labor: [],
    ...partial,
  };
}

function month(jobs: JobEvidence[], over: Partial<MonthEvidence> = {}): MonthEvidence {
  return {
    ym: "2026-07", year: 2026, month: 7, monthLabel: "July 2026",
    folderRoot: "/2026 Invoicing/08 August 26 (July Billing)/",
    jobs, emailChecked: false, emails: [], mailWindow: null, mailTruncated: false,
    laborRates: null,
    warnings: [],
    ...over,
  };
}

/** DEFAULT_SETTINGS with one check's block replaced. Deep-ish clone so a test
 *  can never leak policy into the next one. */
function withCheck(id: string, patch: { enabled?: boolean; config?: unknown }): InvoiceReviewSettings {
  const base = structuredClone(DEFAULT_SETTINGS) as InvoiceReviewSettings;
  const checks = base.checks as unknown as Record<string, { enabled: boolean; config: unknown }>;
  checks[id] = { ...checks[id], ...patch };
  return base;
}

/** A job whose whole month was captured and never billed — the uninvoiced
 *  check's headline finding, and a convenient thing to switch on and off. */
const neverBilled = month([
  job({ invoices: [], bills: [bill({ id: "b1", cost: 900, invoiced: false })] }),
]);

const kinds = (m: MonthEvidence, s?: InvoiceReviewSettings) =>
  runChecks(structuredClone(m), s).map((f) => f.kind);

describe("the registry itself", () => {
  it("gives every declared check a settings block", () => {
    const blocks = DEFAULT_SETTINGS.checks as unknown as Record<string, unknown>;
    for (const c of ALL_CHECKS) expect(blocks[c.id], `no settings block for "${c.id}"`).toBeTruthy();
  });

  it("has no two checks claiming the same finding kind", () => {
    // A kind is half of a finding's suppression identity, so two owners would
    // let one ruling silence findings the office never saw. The registry
    // asserts this at load; this pins it as a rule rather than an accident.
    const owner = new Map<string, string>();
    for (const c of ALL_CHECKS) {
      for (const k of c.kinds) {
        expect(owner.get(k), `"${k}" is claimed by both ${owner.get(k)} and ${c.id}`).toBeUndefined();
        owner.set(k, c.id);
      }
    }
  });

  it("declares a scope for every check", () => {
    for (const c of ALL_CHECKS) expect(["job", "invoice", "month"]).toContain(c.scope);
  });
});

describe("policy comes from settings", () => {
  it("runs a check that is enabled", () => {
    expect(kinds(neverBilled)).toContain("job-not-invoiced");
  });

  it("does not run a check that is disabled", () => {
    expect(kinds(neverBilled, withCheck("uninvoiced", { enabled: false }))).not.toContain(
      "job-not-invoiced",
    );
  });

  it("leaves the other checks running when one is disabled", () => {
    const m = month([
      job({
        invoices: [invoice({ id: "i1", price: 100, priceWithTax: 100, tax: 5 })],
        bills: [bill({ id: "b1", cost: 50, invoiced: false })],
      }),
    ]);
    const only = kinds(m, withCheck("uninvoiced", { enabled: false }));
    expect(only).not.toContain("bill-uninvoiced");
    expect(only).toContain("math-tax"); // 100 − 100 ≠ 5
  });

  it("honours a threshold from settings", () => {
    // A $10 straggler is reported at the default 50c floor, and silenced by a
    // floor above it — the same evidence, two policies.
    const m = month([
      job({
        invoices: [invoice({ id: "i1" })],
        bills: [bill({ id: "b1", cost: 10, invoiced: false })],
      }),
    ]);
    expect(kinds(m)).toContain("bill-uninvoiced");
    expect(kinds(m, withCheck("uninvoiced", { config: { remainderFloor: 25 } }))).not.toContain(
      "bill-uninvoiced",
    );
  });

  it("can switch off one half of a check without the other", () => {
    const m = month([
      job({
        invoices: [invoice({ id: "i1" })],
        bills: [],
        folder: {
          path: "/x/", found: true, folderId: "F", truncated: false,
          files: [
            {
              id: "f1", name: "f1.pdf", url: "u", mimeType: "application/pdf", size: 1,
              parsed: true, csi: [{ code: "06 20 23", amount: 42 }], amount: 42, tail: "Vendor",
            },
          ],
        },
      }),
    ]);
    expect(kinds(m)).toContain("backup-unmatched");
    expect(
      kinds(m, withCheck("backup", { config: { reportUnmatchedFiles: false, reportDuplicates: true } })),
    ).not.toContain("backup-unmatched");
  });
});

describe("a check that throws", () => {
  /** A month whose job list contains something a check will choke on. `bills`
   *  being null is not reachable from evidence.ts — it stands in for whatever
   *  odd shape production eventually produces. */
  const broken = () => {
    const m = month([job({ bills: null as unknown as BillRef[] })]);
    return m;
  };

  it("does not take the review down with it", () => {
    expect(() => runChecks(broken())).not.toThrow();
  });

  it("records the failure as an evidence warning, so it cannot read as a pass", () => {
    // This is the whole point: a check that silently stopped working and a
    // check that found nothing must never look the same on screen. The page
    // renders a non-empty `warnings` as "this review is incomplete".
    const m = broken();
    runChecks(m);
    expect(m.warnings.length).toBeGreaterThan(0);
    expect(m.warnings.join(" ")).toMatch(/check failed/i);
  });

  it("still runs the checks that didn't throw", () => {
    const m = month([
      job({ jobId: "J1", bills: null as unknown as BillRef[] }),
      job({ jobId: "J2", invoices: [], bills: [bill({ id: "b1", cost: 900, invoiced: false })] }),
    ]);
    expect(runChecks(m).map((f) => f.kind)).toContain("job-not-invoiced");
  });
});
