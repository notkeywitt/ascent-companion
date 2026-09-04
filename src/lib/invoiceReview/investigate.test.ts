/**
 * The investigator's tools.
 *
 * The tools are pure functions over the review payload, which is the whole
 * reason this pass is testable at all: the model's judgement cannot be pinned
 * down, but WHAT IT IS SHOWN can be, exactly. If `search_backup_by_amount`
 * misses a PDF filed under another job, Claude will confidently confirm a
 * finding that had a five-second innocent explanation — so the lookups are
 * where the value of the whole stage actually sits.
 *
 * `record_disposition` gets the most attention, because it is the one tool that
 * writes anything, and the one place a hallucinated finding key could otherwise
 * become a stored verdict attached to nothing.
 */
import { describe, expect, it } from "vitest";

import { attachDispositions } from "./dispositions";
import {
  billsByVendor,
  buildInvestigateTools,
  findingContext,
  findingDigest,
  normsSummary,
  searchBackupByAmount,
  type DispositionInput,
} from "./investigateTools";
import { findingKey } from "./types";
import type {
  BackupFile,
  BillRef,
  Finding,
  FindingDisposition,
  JobEvidence,
  MonthEvidence,
  ReviewPayload,
} from "./types";

function file(partial: Partial<BackupFile> & { id: string; amount: number }): BackupFile {
  return {
    name: `${partial.id}.pdf`,
    url: `https://drive.google.com/file/d/${partial.id}/view`,
    mimeType: "application/pdf",
    size: 1000,
    parsed: true,
    csi: [{ code: "06 20 23", amount: partial.amount }],
    tail: "Sunset Builders Supply",
    ...partial,
  };
}

function bill(partial: Partial<BillRef> & { id: string; cost: number }): BillRef {
  return { label: partial.id, vendor: "Sunset Builders Supply", status: "approved", invoiced: true, invoiceIds: [], sentInvoiceIds: [], issueDate: '2026-07-15', lineCount: 1, taxAmount: 0, qboIsIgnored: false, ...partial };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1", jobName: "Otis Perkins Addition", customerName: "Ferron",
    neverInvoiced: false, invoices: [], bills: [],
    folder: { path: "/2026/Ferron/Otis/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0, uninvoicedTimeCost: 0, draftBillsCost: 0, draftBillCount: 0,
    draftBills: [],
    labor: [],
    ...partial,
  };
}

function finding(partial: Partial<Finding> = {}): Finding {
  const kind = partial.kind ?? "backup-missing";
  const jobId = partial.jobId ?? "J1";
  return {
    key: findingKey(kind, jobId, "b1"),
    kind, severity: "error",
    title: "No backup filed — Sunset Builders Supply $1,234.56",
    detail: "…", jobId, jobName: "Otis Perkins Addition", customerName: "Ferron",
    invoiceId: "", invoiceNumber: "", amount: 1234.56,
    ...partial,
  };
}

function payload(jobs: JobEvidence[], findings: Finding[], over: Partial<MonthEvidence> = {}): ReviewPayload {
  const evidence: MonthEvidence = {
    ym: "2026-07", year: 2026, month: 7, monthLabel: "July 2026",
    folderRoot: "/2026 Invoicing/", jobs,
    emailChecked: false, emails: [], mailWindow: null, mailTruncated: false,
    laborRates: null, warnings: [],
    ...over,
  };
  return {
    evidence, findings,
    summary: "", summarySource: "fallback",
    generatedAt: "2026-08-11T00:00:00.000Z", durationMs: 1,
  };
}

describe("get_finding_context", () => {
  it("returns the finding with the job it sits on", () => {
    const f = finding();
    const ctx = findingContext(payload([job({ bills: [bill({ id: "b1", cost: 1234.56 })] })], [f]), f.key);
    expect(ctx.found).toBe(true);
    if (!ctx.found) return;
    expect(ctx.finding.title).toContain("Sunset");
    expect(ctx.job?.bills).toHaveLength(1);
  });

  it("says so plainly when the key matches nothing", () => {
    const ctx = findingContext(payload([job()], []), "made-up-key");
    expect(ctx.found).toBe(false);
  });

  it("surfaces a finding the office already ruled on", () => {
    // Claude must know not to re-litigate a human decision.
    const f = finding({
      suppressedBy: { reason: "Deposit draw, never has backup.", by: "office@x", at: "2026-08-01", scope: "finding" },
    });
    const ctx = findingContext(payload([job()], [f]), f.key);
    expect(ctx.found).toBe(true);
    if (!ctx.found) return;
    expect(ctx.finding.alreadyRuledOn).toContain("Deposit draw");
  });

  it("reports the age when the review remembers one", () => {
    const f = finding({ history: { firstSeenAt: "2026-03-02T00:00:00.000Z", runsSeen: 9, isNew: false } });
    const ctx = findingContext(payload([job()], [f]), f.key);
    if (!ctx.found) return;
    expect(ctx.finding.age).toContain("2026-03-02");
  });
});

describe("search_backup_by_amount — the tool that replaces a human chore", () => {
  const misfiled = payload(
    [
      job({ jobId: "J1", jobName: "Otis Perkins Addition" }),
      job({
        jobId: "J2", jobName: "Okonkwo Kitchen", customerName: "Okonkwo",
        folder: { path: "/2026/Okonkwo/Kitchen/", found: true, folderId: "F2", truncated: false, files: [file({ id: "f9", amount: 1234.56 })] },
      }),
    ],
    [finding()],
  );

  it("finds a PDF filed under a DIFFERENT job — the usual explanation", () => {
    const r = searchBackupByAmount(misfiled, 1234.56);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].filedUnderJob).toBe("Okonkwo Kitchen");
  });

  it("searches every job, not just the one the finding is on", () => {
    expect(searchBackupByAmount(misfiled, 1234.56).jobsSearched).toBe(2);
  });

  it("says plainly when nothing matches, rather than returning a bare empty list", () => {
    const r = searchBackupByAmount(misfiled, 999);
    expect(r.hits).toEqual([]);
    expect(r.note).toContain("Nothing");
  });

  it("matches a credit filed as a negative amount", () => {
    const p = payload(
      [job({ folder: { path: "/x/", found: true, folderId: "F", truncated: false, files: [file({ id: "c1", amount: -71.97 })] } })],
      [],
    );
    expect(searchBackupByAmount(p, 71.97).hits).toHaveLength(1);
  });

  it("ignores files the pipeline could not parse", () => {
    // An unparsed file has no coded amount — it is a statement or a photo, not
    // bill backup, and must not be offered as a match.
    const p = payload(
      [job({ folder: { path: "/x/", found: true, folderId: "F", truncated: false, files: [file({ id: "s1", amount: 500, parsed: false })] } })],
      [],
    );
    expect(searchBackupByAmount(p, 500).hits).toEqual([]);
  });
});

describe("find_bills_by_vendor", () => {
  const p = payload(
    [
      job({ jobId: "J1", bills: [bill({ id: "b1", cost: 100, vendor: "Sunset Builders Supply" })] }),
      job({ jobId: "J2", jobName: "Okonkwo Kitchen", bills: [bill({ id: "b2", cost: 200, vendor: "SUNSET BUILDERS SUPPLY LLC" })] }),
    ],
    [],
  );

  it("finds a vendor's bills across every job", () => {
    expect(billsByVendor(p, "sunset").matches).toBe(2);
  });

  it("is case-insensitive, so a different spelling still matches", () => {
    expect(billsByVendor(p, "SUNSET").matches).toBe(2);
  });

  it("returns nothing for a vendor with no bills", () => {
    expect(billsByVendor(p, "nobody").bills).toEqual([]);
  });
});

describe("get_norms", () => {
  it("states plainly that there are no baselines, rather than returning empty", () => {
    // The distinction Claude must not blur: no baseline is NO signal, and an
    // empty object would read as "nothing was unusual".
    const r = normsSummary(payload([job()], []));
    expect(r.available).toBe(false);
    expect(r.note).toContain("Do not infer");
  });

  it("reports a customer's usual markup as a percentage", () => {
    const p = payload([job()], [], {
      norms: {
        ym: "2026-07", windowMonths: 12, monthsOfHistory: 9, vendors: [],
        customers: [{ key: "ferron", name: "Ferron", monthsSeen: 9, monthsOfHistory: 9, typicalMarkup: 1.22, typicalMonthlyPrice: 60000 }],
      },
    });
    const r = normsSummary(p);
    expect(r.available).toBe(true);
    expect(r.customers?.[0].typicalMarkupPercent).toBe(22);
  });
});

describe("record_disposition", () => {
  const f = finding();
  const build = (recorded: DispositionInput[]) =>
    buildInvestigateTools(payload([job()], [f]), null, (d) => recorded.push(d));
  const tool = (recorded: DispositionInput[]) =>
    build(recorded).find((t) => t.name === "record_disposition")!;

  it("records a valid verdict", async () => {
    const got: DispositionInput[] = [];
    await tool(got).handler({ key: f.key, verdict: "confirmed", why: "No PDF anywhere." });
    expect(got).toHaveLength(1);
    expect(got[0].verdict).toBe("confirmed");
  });

  it("REFUSES a key that is not in this review", async () => {
    // The important one. Without this, a hallucinated key becomes a stored
    // verdict attached to no finding, which nothing downstream would ever show.
    const got: DispositionInput[] = [];
    await expect(
      tool(got).handler({ key: "invented|J9|zzz", verdict: "confirmed", why: "…" }),
    ).rejects.toThrow(/No finding/);
    expect(got).toEqual([]);
  });

  it("refuses a verdict outside the three allowed", async () => {
    const got: DispositionInput[] = [];
    await expect(
      tool(got).handler({ key: f.key, verdict: "looks-bad", why: "…" }),
    ).rejects.toThrow(/verdict must be/);
  });

  it("refuses an empty key", async () => {
    const got: DispositionInput[] = [];
    await expect(tool(got).handler({ key: "  ", verdict: "confirmed", why: "…" })).rejects.toThrow();
  });
});

describe("attachDispositions", () => {
  const d: FindingDisposition = {
    verdict: "probably-fine", why: "Filed under the Okonkwo job.",
    suggestedAction: "Move the PDF.", model: "claude-opus-5", at: "2026-08-11T00:00:00.000Z",
  };

  it("stamps a finding with its verdict", () => {
    const f = finding();
    expect(attachDispositions([f], new Map([[f.key, d]]))[0].disposition?.verdict).toBe("probably-fine");
  });

  it("does NOT change severity — a verdict never demotes a finding", () => {
    // The safety invariant of the whole stage: only a ruling silences anything.
    const f = finding({ severity: "error" });
    const out = attachDispositions([f], new Map([[f.key, d]]))[0];
    expect(out.severity).toBe("error");
    expect(out.suppressedBy).toBeUndefined();
  });

  it("leaves the input untouched, so raw check output stays inspectable", () => {
    const f = finding();
    attachDispositions([f], new Map([[f.key, d]]));
    expect(f.disposition).toBeUndefined();
  });

  it("leaves findings with no verdict alone", () => {
    const f = finding();
    expect(attachDispositions([f], new Map())[0].disposition).toBeUndefined();
  });
});

describe("findingDigest", () => {
  it("caps a long list so one pass stays bounded", () => {
    const many = Array.from({ length: 90 }, (_, i) => finding({ key: `k${i}` }));
    expect(findingDigest(many, 60)).toHaveLength(60);
  });
});
