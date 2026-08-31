/**
 * The checks are the part of the invoice review that decides whether money is
 * wrong, so they are the part that gets tested. Every case here is built from a
 * real shape seen in the production data: the filename convention the Drive
 * tree actually uses, the two identical $7.99 Sunset tickets that must not
 * collapse onto one PDF, the credit printed as "($71.97)".
 */
import { describe, expect, it } from "vitest";

import { buildBrief } from "./brief";
import { matchBackup, runChecks, fallbackSummary } from "./checks";
import type {
  BackupFile,
  BillRef,
  EmailThread,
  Finding,
  InvoiceEvidence,
  InvoiceLine,
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
    tail: "Vendor Ferron Pushed to JT",
    ...partial,
  };
}

function bill(partial: Partial<BillRef> & { id: string; cost: number }): BillRef {
  return {
    label: partial.id,
    vendor: "Vendor",
    status: "approved",
    invoiced: true,
    invoiceIds: [],
    ...partial,
  };
}

function invoice(partial: Partial<InvoiceEvidence> & { id: string }): InvoiceEvidence {
  return {
    number: "100",
    name: "July billing",
    status: "approved",
    issueDate: "2026-07-31",
    dueDate: "2026-08-30",
    cost: 0,
    price: 0,
    priceWithTax: 0,
    tax: 0,
    taxRate: 0,
    amountPaid: 0,
    balance: 0,
    lines: [],
    billIds: [],
    email: null,
    jtUrl: "https://app.jobtread.com/jobs/J/documents/" + partial.id,
    ...partial,
  };
}

function line(partial: Partial<InvoiceLine> & { id: string; price: number }): InvoiceLine {
  return {
    name: "Line", description: "", code: "", codeName: "",
    quantity: 0, unitPrice: 0, isTaxable: true,
    ...partial,
  };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1",
    jobName: "Otis Perkins Addition",
    customerName: "Ferron",
    invoices: [],
    bills: [],
    folder: { path: "/2026 Invoicing/08 August 26 (July Billing)/Ferron/Otis Perkins Addition/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0,
    uninvoicedTimeCost: 0,
    draftBillsCost: 0,
    draftBillCount: 0,
    ...partial,
  };
}

function month(jobs: JobEvidence[], over: Partial<MonthEvidence> = {}): MonthEvidence {
  return {
    ym: "2026-07",
    year: 2026,
    month: 7,
    monthLabel: "July 2026",
    folderRoot: "/2026 Invoicing/08 August 26 (July Billing)/",
    jobs,
    // Off by default: the pre-existing cases are all about JobTread and Drive,
    // and every one of them would otherwise grow an email finding.
    emailChecked: false,
    warnings: [],
    ...over,
  };
}

function thread(partial: Partial<EmailThread> & { threadId: string }): EmailThread {
  return {
    subject: "Invoice #100 from Ascent Building Co.",
    url: `https://mail.google.com/mail/u/0/#all/${partial.threadId}`,
    messages: 1,
    firstDate: "2026-08-01T17:00:00.000Z",
    lastDate: "2026-08-01T17:00:00.000Z",
    lastFrom: "office@ascentbuildingco.com",
    lastFromName: "Ascent Office",
    lastInbound: false,
    matchedOn: "number",
    labels: [],
    ...partial,
  };
}

/** A ReviewPayload around a month + findings, for the briefing tests. */
function payload(m: MonthEvidence, findings: Finding[]): ReviewPayload {
  return {
    evidence: m,
    findings,
    summary: fallbackSummary(m, findings),
    summarySource: "fallback",
    generatedAt: "2026-08-11T00:00:00.000Z",
    durationMs: 1,
  };
}

const kinds = (fs: { kind: string }[]) => fs.map((f) => f.kind).sort();

describe("matchBackup", () => {
  it("pairs a bill with the PDF whose filename total equals its cost", () => {
    const r = matchBackup(
      [bill({ id: "b1", cost: 316.8, vendor: "Sunset Builders Supply" })],
      [file({ id: "f1", amount: 316.8, tail: "Sunset Builders Supply 695829 Ferron Pushed to JT" })],
    );
    expect(r.unmatchedBills).toHaveLength(0);
    expect(r.unmatchedFiles).toHaveLength(0);
    expect(r.matched.get("b1")?.id).toBe("f1");
  });

  it("pairs two same-amount tickets one-to-one instead of double-matching", () => {
    // Two real July Sunset tickets, both $7.99, different invoice numbers.
    const r = matchBackup(
      [bill({ id: "b1", cost: 7.99 }), bill({ id: "b2", cost: 7.99 })],
      [
        file({ id: "f1", amount: 7.99, tail: "Sunset Builders Supply 695948 Ferron Pushed to JT" }),
        file({ id: "f2", amount: 7.99, tail: "Sunset Builders Supply 696224 Ferron Pushed to JT" }),
      ],
    );
    expect(r.unmatchedBills).toHaveLength(0);
    expect(r.unmatchedFiles).toHaveLength(0);
    expect(new Set([r.matched.get("b1")?.id, r.matched.get("b2")?.id])).toEqual(
      new Set(["f1", "f2"]),
    );
  });

  it("uses the vendor name only to break an amount tie", () => {
    const r = matchBackup(
      [bill({ id: "b1", cost: 50, vendor: "Reggio Register" })],
      [
        file({ id: "wrong", amount: 50, tail: "Island Sash and Door Ferron Pushed to JT" }),
        file({ id: "right", amount: 50, tail: "Reggio Register Ferron Pushed to JT" }),
      ],
    );
    expect(r.matched.get("b1")?.id).toBe("right");
  });

  it("ignores files it could not parse — a statement is not bill backup", () => {
    const r = matchBackup(
      [],
      [file({ id: "stmt", amount: 0, parsed: false, csi: [], tail: "Sunset Statement - FERRON - July 2026" })],
    );
    expect(r.unmatchedFiles).toHaveLength(0);
  });

  it("matches a credit filed as a negative amount", () => {
    const r = matchBackup(
      [bill({ id: "b1", cost: -71.97 })],
      [file({ id: "f1", amount: -71.97 })],
    );
    expect(r.matched.get("b1")?.id).toBe("f1");
  });

  it("reports a bill with no PDF and a PDF with no bill separately", () => {
    const r = matchBackup([bill({ id: "b1", cost: 100 })], [file({ id: "f1", amount: 250 })]);
    expect(r.unmatchedBills.map((b) => b.id)).toEqual(["b1"]);
    expect(r.unmatchedFiles.map((f) => f.id)).toEqual(["f1"]);
  });
});

describe("backup coverage", () => {
  it("flags an invoiced bill with no backup on file", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", price: 100, priceWithTax: 100, cost: 100 })],
          bills: [bill({ id: "b1", cost: 100, invoiced: true })],
        }),
      ]),
    );
    expect(kinds(f)).toContain("backup-missing");
  });

  it("does not ask for backup on a bill that was never invoiced", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1" })],
          bills: [bill({ id: "b1", cost: 100, invoiced: false })],
        }),
      ]),
    );
    expect(kinds(f)).not.toContain("backup-missing");
  });

  it("flags a missing billing folder once, not one finding per bill", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1" })],
          bills: [bill({ id: "b1", cost: 10 }), bill({ id: "b2", cost: 20 })],
          folder: { path: "/2026 Invoicing/08 August 26 (July Billing)/Ferron/", found: false, folderId: "", files: [], truncated: false, missingAt: "2026 Invoicing/08 August 26 (July Billing)/Ferron" },
        }),
      ]),
    );
    expect(kinds(f).filter((k) => k.startsWith("backup"))).toEqual(["backup-folder-missing"]);
  });

  it("says nothing about backup for a job that was not invoiced at all", () => {
    const f = runChecks(month([job({ invoices: [], bills: [bill({ id: "b1", cost: 100 })] })]));
    expect(kinds(f).filter((k) => k.startsWith("backup"))).toEqual([]);
  });

  it("flags two copies of the same PDF as a probable double charge", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1" })],
          bills: [bill({ id: "b1", cost: 27, invoiced: true })],
          folder: {
            path: "/p/", found: true, folderId: "F", truncated: false,
            files: [
              file({ id: "f1", amount: 27, name: "27.pdf", tail: "LSWDD Ferron Pushed to JT" }),
              file({ id: "f2", amount: 27, name: "27 (2).pdf", tail: "LSWDD Ferron Pushed to JT (2)" }),
            ],
          },
        }),
      ]),
    );
    expect(kinds(f)).toContain("backup-duplicate");
  });
});

describe("math", () => {
  it("flags a line that does not multiply out", () => {
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", price: 300, priceWithTax: 300,
              lines: [
                line({ id: "l1", name: "Framing", code: "06 10 00", quantity: 3, unitPrice: 100, price: 300 }),
                line({ id: "l2", name: "Trim", quantity: 2, unitPrice: 50, price: 0 }),
              ],
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-line");
  });

  it("accepts a flat-price line with no quantity", () => {
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", price: 500, priceWithTax: 500,
              lines: [line({ id: "l1", name: "Allowance draw", price: 500 })],
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).not.toContain("math-line");
    expect(kinds(f)).not.toContain("math-total");
  });

  it("flags lines that do not sum to the invoice total", () => {
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", price: 1000, priceWithTax: 1000,
              lines: [line({ id: "l1", price: 400 })],
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-total");
  });

  it("tolerates a cent of floating-point drift across many lines", () => {
    const lines = Array.from({ length: 3 }, (_, i) =>
      line({ id: `l${i}`, quantity: 3, unitPrice: 0.1, price: 0.3 }),
    );
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", price: 0.9, priceWithTax: 0.9, lines })] })]),
    );
    expect(kinds(f)).not.toContain("math-total");
    expect(kinds(f)).not.toContain("math-line");
  });

  it("flags tax that does not reconcile", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", price: 1000, tax: 50, priceWithTax: 1100 })] })]),
    );
    expect(kinds(f)).toContain("math-tax");
  });

  it("flags a balance that does not reconcile", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", price: 1000, priceWithTax: 1000, amountPaid: 400, balance: 500 })],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-balance");
  });
});

describe("period & scope", () => {
  it("flags an invoice issued outside the billing month", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", issueDate: "2026-08-05" })] })]),
    );
    expect(kinds(f)).toContain("period-issue-date");
  });

  it("accepts the last day of the billing month", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", issueDate: "2026-07-31" })] })]),
    );
    expect(kinds(f)).not.toContain("period-issue-date");
  });

  it("flags cost pulled onto the invoice from outside the month", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", cost: 900, price: 900, priceWithTax: 900 })],
          bills: [bill({ id: "b1", cost: 400, invoiceIds: ["i1"], invoiced: true })],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-cost-basis");
  });

  it("does not flag an invoice that covers only part of the month", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", cost: 400, price: 400, priceWithTax: 400 })],
          bills: [
            bill({ id: "b1", cost: 400, invoiceIds: ["i1"], invoiced: true }),
            bill({ id: "b2", cost: 300, invoiced: false }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).not.toContain("math-cost-basis");
  });

  it("flags a bill carried by two live invoices", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1" }), invoice({ id: "i2", number: "101" })],
          bills: [bill({ id: "b1", cost: 500, invoiceIds: ["i1", "i2"], invoiced: true })],
        }),
      ]),
    );
    expect(kinds(f)).toContain("scope-duplicate-bill");
  });

  it("flags a month with billable cost left off every invoice", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1" })], uninvoicedBillsCost: 1200, uninvoicedTimeCost: 300 })]),
    );
    expect(kinds(f)).toContain("scope-uninvoiced");
  });

  it("ignores a sub-dollar remainder as rounding", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1" })], uninvoicedBillsCost: 0.02 })]),
    );
    expect(kinds(f)).not.toContain("scope-uninvoiced");
  });

  it("flags draft bills that could not be invoiced", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1" })], draftBillCount: 2, draftBillsCost: 900 })]),
    );
    expect(kinds(f)).toContain("scope-drafts");
  });
});

describe("ordering and summary", () => {
  it("puts errors before warnings and big money before small", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", issueDate: "2026-08-05" })],
          uninvoicedBillsCost: 5000,
          draftBillCount: 1,
          draftBillsCost: 10,
        }),
      ]),
    );
    expect(f[0].severity).toBe("error");
    expect(f[0].kind).toBe("scope-uninvoiced");
  });

  it("says nothing is wrong when nothing is wrong", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })] })]);
    expect(fallbackSummary(m, runChecks(m))).toContain("nothing to flag");
  });

  it("does not count a suppressed finding as a problem", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })], uninvoicedBillsCost: 5000 })]);
    const suppressed = runChecks(m).map((f) => ({
      ...f,
      suppressedBy: { reason: "held back on purpose", by: "office", at: "", scope: "finding" as const },
    }));
    expect(fallbackSummary(m, suppressed)).toContain("nothing to flag");
  });
});

describe("the office mailbox", () => {
  const withEmail = (jobs: JobEvidence[]) => month(jobs, { emailChecked: true });

  it("reports nothing at all when the mailbox was not searched", () => {
    // The dangerous case: a skipped check must never read as a passed one.
    const f = runChecks(month([job({ invoices: [invoice({ id: "i1", email: null })] })]));
    expect(kinds(f).filter((k) => k.startsWith("email"))).toEqual([]);
  });

  it("says so ONCE when no invoice in the month has any trace", () => {
    // JobTread sending invoices without copying the office is the normal case;
    // flagging all three would be the cry-wolf failure this design exists to avoid.
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({ id: "i1", email: { matchedOn: "", threads: [] } }),
            invoice({ id: "i2", number: "101", email: { matchedOn: "", threads: [] } }),
            invoice({ id: "i3", number: "102", email: { matchedOn: "", threads: [] } }),
          ],
        }),
      ]),
    );
    const email = f.filter((x) => x.kind.startsWith("email"));
    expect(email.map((x) => x.kind)).toEqual(["email-no-trace"]);
    expect(email[0].severity).toBe("info");
  });

  it("flags the odd one out when the others DO have traces", () => {
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({ id: "i1", email: { matchedOn: "number", threads: [thread({ threadId: "t1" })] } }),
            invoice({ id: "i2", number: "101", email: { matchedOn: "", threads: [] } }),
          ],
        }),
      ]),
    );
    const email = f.filter((x) => x.kind.startsWith("email"));
    expect(email.map((x) => x.kind)).toEqual(["email-not-sent"]);
    expect(email[0].invoiceNumber).toBe("101");
  });

  it("flags a client reply nobody answered", () => {
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({
              id: "i1",
              email: {
                matchedOn: "number",
                threads: [
                  thread({
                    threadId: "t1",
                    messages: 3,
                    lastFrom: "kevin@ferron.example",
                    lastFromName: "Kevin Ferron",
                    lastInbound: true,
                  }),
                ],
              },
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("email-client-replied");
  });

  it("names the concern when the reply's subject raises one", () => {
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({
              id: "i1",
              email: {
                matchedOn: "number",
                threads: [
                  thread({
                    threadId: "t1",
                    subject: "Re: Invoice #100 — I think this is a duplicate charge, wrong amount?",
                    lastFrom: "kevin@ferron.example",
                    lastInbound: true,
                  }),
                ],
              },
            }),
          ],
        }),
      ]),
    );
    const hit = f.find((x) => x.kind === "email-client-replied");
    expect(hit?.detail).toContain("wrong");
  });

  it("says nothing when we had the last word", () => {
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({ id: "i1", email: { matchedOn: "number", threads: [thread({ threadId: "t1" })] } }),
          ],
        }),
      ]),
    );
    expect(kinds(f).filter((k) => k.startsWith("email"))).toEqual([]);
  });

  it("judges by the newest thread, not an old one that ended inbound", () => {
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({
              id: "i1",
              email: {
                matchedOn: "number",
                threads: [
                  thread({ threadId: "old", lastDate: "2026-08-01T00:00:00.000Z", lastInbound: true }),
                  thread({ threadId: "new", lastDate: "2026-08-09T00:00:00.000Z", lastInbound: false }),
                ],
              },
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f).filter((k) => k.startsWith("email"))).toEqual([]);
  });

  it("warns that a weak customer-name match may be about something else", () => {
    const f = runChecks(
      withEmail([
        job({
          invoices: [
            invoice({
              id: "i1",
              email: {
                matchedOn: "customer",
                threads: [thread({ threadId: "t1", matchedOn: "customer", lastInbound: true })],
              },
            }),
          ],
        }),
      ]),
    );
    const hit = f.find((x) => x.kind === "email-client-replied");
    expect(hit?.detail).toContain("may be about something else");
  });
});

describe("the paste-into-Claude briefing", () => {
  it("tells Claude not to redo the arithmetic", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })] })]);
    const brief = buildBrief(payload(m, runChecks(m)));
    expect(brief).toContain("Do not redo the");
    expect(brief).toContain("July 2026");
  });

  it("says plainly that the mailbox was not searched", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })] })]);
    expect(buildBrief(payload(m, runChecks(m)))).toContain("not** searched");
  });

  it("does not claim a gap when every leg ran", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })] })], { emailChecked: true });
    expect(buildBrief(payload(m, runChecks(m)))).not.toContain("This review is incomplete");
  });

  it("carries the findings, their money, and the rulings already made", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })], uninvoicedBillsCost: 5000 })]);
    const findings = runChecks(m);
    const brief = buildBrief(payload(m, findings));
    expect(brief).toContain("Needs fixing");
    expect(brief).toContain("$5,000.00");

    const suppressed = findings.map((f) => ({
      ...f,
      suppressedBy: { reason: "held back on purpose", by: "office", at: "", scope: "finding" as const },
    }));
    const asideBrief = buildBrief(payload(m, suppressed));
    expect(asideBrief).toContain("Already set aside");
    expect(asideBrief).toContain("held back on purpose");
  });

  it("can be built without the preamble, for a caller that framed the task itself", () => {
    const m = month([job()]);
    expect(buildBrief(payload(m, []), { includePreamble: false })).not.toContain("You are helping me");
  });
});
