/**
 * The checks are the part of the invoice review that decides whether money is
 * wrong, so they are the part that gets tested. Every case here is built from a
 * real shape seen in the production data: the filename convention the Drive
 * tree actually uses, the two identical $7.99 Sunset tickets that must not
 * collapse onto one PDF, the credit printed as "($71.97)".
 */
import { describe, expect, it } from "vitest";

import { buildBrief } from "./brief";
import { runChecks } from "./registry";
import { billLink, matchBackup } from "./checks/shared";
import { fallbackSummary } from "./summary";
import { isNeverInvoiced } from "./types";
import type {
  BackupFile,
  BillRef,
  BillEmail,
  Finding,
  InvoiceEvidence,
  InvoiceLine,
  JobEvidence,
  LaborEntryRef,
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

function labor(partial: Partial<LaborEntryRef> & { id: string; cost: number }): LaborEntryRef {
  return {
    employee: "Ty O'Steen",
    payType: "Regular Pay",
    rate: 85,
    hours: partial.cost / 85,
    code: "01 31 10",
    day: "2026-08-15",
    invoiceIds: [],
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
    sentInvoiceIds: [],
    issueDate: '2026-07-15',
    lineCount: 1, taxAmount: 0,
    qboIsIgnored: false,
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
    jtUrl: "https://app.jobtread.com/jobs/J/documents/" + partial.id,
    ...partial,
  };
}

function line(partial: Partial<InvoiceLine> & { id: string; price: number }): InvoiceLine {
  return {
    name: "Line", description: "", code: "", codeName: "",
    quantity: 0, unitCost: 0, unitPrice: 0, cost: 0, isTaxable: true,
    ...partial,
  };
}

function job(partial: Partial<JobEvidence> = {}): JobEvidence {
  return {
    jobId: "J1",
    jobName: "Otis Perkins Addition",
    customerName: "Ferron",
    neverInvoiced: false,
    invoices: [],
    bills: [],
    folder: { path: "/2026 Invoicing/08 August 26 (July Billing)/Ferron/Otis Perkins Addition/", found: true, folderId: "F", files: [], truncated: false },
    uninvoicedBillsCost: 0,
    uninvoicedTimeCost: 0,
    draftBillsCost: 0,
    draftBillCount: 0,
    draftBills: [],
    labor: [],
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
    emails: [],
    mailWindow: null,
    mailTruncated: false,
    laborRates: null,
    warnings: [],
    ...over,
  };
}

function mail(partial: Partial<BillEmail> & { threadId: string }): BillEmail {
  return {
    subject: "Invoice 4471 from Reggio Register",
    from: "billing@reggioregister.example",
    fromAddress: "billing@reggioregister.example",
    fromName: "Reggio Register",
    fromDomain: "reggioregister.example",
    date: "2026-07-18T17:00:00.000Z",
    attachmentCount: 1,
    subjectAmount: null,
    threadUrl: `https://mail.google.com/mail/u/0/#all/${partial.threadId}`,
    labels: [],
    vendorId: "V1",
    vendorName: "Reggio Register",
    matchedBillId: "b1",
    checked: true,
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

  it("pairs a bill with a backup filed one cent apart", () => {
    // Berger Main House, August 2026 billing: Island Custom Woodworks bill #10
    // is $4,163.75 in JobTread and the filed PDF is named "... - $4163.74 - ...".
    // Neither side is wrong — JobTread rounds each bill line to cents and sums
    // those, the filename sums quantity x rate at full precision and rounds
    // once — and the tolerance exists to absorb exactly this. It did not, because
    // 4163.75 - 4163.74 is 0.010000000000218279 in floating point, which is
    // greater than a 0.01 tolerance. The review called a filed PDF unfiled.
    const r = matchBackup(
      [bill({ id: "b1", cost: 4163.75, vendor: "Island Custom Woodworks" })],
      [file({ id: "f1", amount: 4163.74, tail: "Island Custom Woodworks Kevin Berger Pushed to JT" })],
    );
    expect(r.unmatchedBills).toHaveLength(0);
    expect(r.unmatchedFiles).toHaveLength(0);
    expect(r.matched.get("b1")?.id).toBe("f1");
  });

  it("allows a nine-line bill the drift nine lines can produce", () => {
    // Berger's real bill has 9 lines in 1 CSI group. JobTread rounds each line
    // and sums; the filename sums the group and rounds once. Each rounded sum
    // can be out half a cent, so the bound is ceil((9 + 1) / 2) = 5 cents.
    // The real drift was 1 cent, but the bound is what has to hold.
    const nineLine = bill({ id: "b1", cost: 4163.75, lineCount: 9, vendor: "Island Custom Woodworks" });
    for (const amount of [4163.7, 4163.74, 4163.8]) {
      const r = matchBackup([nineLine], [file({ id: "f1", amount })]);
      expect(r.matched.get("b1")?.id).toBe("f1");
    }
  });

  it("stops at the bound — six cents is past what nine lines can explain", () => {
    const r = matchBackup(
      [bill({ id: "b1", cost: 4163.75, lineCount: 9 })],
      [file({ id: "f1", amount: 4163.69 })],
    );
    // Same vendor, so it pairs as a DISAGREEMENT rather than two absences —
    // but it must not pass as the same amount.
    expect(r.matched.has("b1")).toBe(false);
    expect(r.mismatched.map((x) => x.bill.id)).toEqual(["b1"]);
  });

  it("does not loosen a single-line bill", () => {
    // The common case by far, and the one where loosening would cost most:
    // pairing is consuming and only UNMATCHED bills are reported, so too wide a
    // window pairs a bill with a neighbour's PDF and hides a real gap. One line
    // in one group is ceil(2 / 2) = 1 cent, exactly the old flat tolerance.
    const r = matchBackup(
      [bill({ id: "b1", cost: 100, lineCount: 1 })],
      [file({ id: "f1", amount: 100.02 })],
    );
    expect(r.matched.has("b1")).toBe(false);
  });

  it("widens nothing when the line count could not be read", () => {
    // lineCount 0 is "JobTread did not tell us", not "zero lines". It must fall
    // back to the flat tolerance rather than compute a bound from a 0.
    const r = matchBackup(
      [bill({ id: "b1", cost: 100, lineCount: 0 })],
      [file({ id: "f1", amount: 100.02 })],
    );
    expect(r.matched.has("b1")).toBe(false);
  });

  it("counts the filename's CSI groups too, not just the bill's lines", () => {
    // Each group is its own rounded sum in `_formatAggCsi`, so a 4-line bill
    // split across 4 codes is ceil((4 + 4) / 2) = 4 cents, not ceil(5/2) = 3.
    const fourCodes = [
      { code: "06 42 00", amount: 25 },
      { code: "01 71 13", amount: 25 },
      { code: "09 91 00", amount: 25 },
      { code: "07 46 23", amount: 25.04 },
    ];
    const r = matchBackup(
      [bill({ id: "b1", cost: 100, lineCount: 4 })],
      [file({ id: "f1", amount: 100.04, csi: fourCodes })],
    );
    expect(r.matched.get("b1")?.id).toBe("f1");
  });

  it("pairs a taxed bill with its PRE-TAX backup filename", () => {
    // Berger Bunkhouse, July 2026. JobTread stores a bill's line costs
    // TAX-INCLUSIVE (_jtGrossUpLineCostsForTax grosses the receipt's pre-tax
    // face value before pushing), while the Drive filename carries the SHEET's
    // pre-tax amounts. Comparing cost alone reported the bill as unbacked AND
    // the PDF backing it as billed to nobody — both halves of the pair wrong.
    for (const [cost, tax, filed] of [
      [574.03, 44.24, 529.79], // Fasteners Plus
      [484.29, 34.65, 449.64], // Fasteners Plus
      [59.5, 4.26, 55.24], // Home Depot
    ]) {
      const r = matchBackup(
        [bill({ id: "b1", cost, taxAmount: tax, vendor: "Fasteners Plus" })],
        [file({ id: "f1", amount: filed, tail: "Fasteners Plus Kevin Berger Pushed to JT" })],
      );
      expect(r.matched.get("b1")?.id, `${cost} vs ${filed}`).toBe("f1");
      expect(r.unmatchedFiles, `${cost} vs ${filed}`).toHaveLength(0);
    }
  });

  it("still pairs an untaxed bill on its face value", () => {
    // JR Granite & Tile, same month, no tax: cost IS the pre-tax total, and
    // three CSI segments sum to it exactly. De-taxing must not break this.
    const r = matchBackup(
      [bill({ id: "b1", cost: 11030, taxAmount: 0, lineCount: 3, vendor: "JR Granite & Tile" })],
      [
        file({
          id: "f1",
          amount: 11030,
          csi: [
            { code: "12 36 00", amount: 4780 },
            { code: "09 30 10", amount: 4000 },
            { code: "09 65 19", amount: 2250 },
          ],
          tail: "JR Granite & Tile Kevin Berger Pushed to JT",
        }),
      ],
    );
    expect(r.matched.get("b1")?.id).toBe("f1");
  });

  it("does not let the tax allowance pair a bill with the wrong PDF", () => {
    // De-taxing adds a second valid figure, not a wider window. A PDF that
    // matches neither the bill's cost nor its de-taxed cost stays unmatched.
    const r = matchBackup(
      [bill({ id: "b1", cost: 574.03, taxAmount: 44.24 })],
      [file({ id: "f1", amount: 500 })],
    );
    expect(r.matched.has("b1")).toBe(false);
  });

  it("pairs a bill with its own backup by vendor when the amounts disagree", () => {
    const r = matchBackup(
      [bill({ id: "b1", cost: 500, vendor: "Fasteners Plus" })],
      [file({ id: "f1", amount: 460, tail: "Fasteners Plus Kevin Berger Pushed to JT" })],
    );
    expect(r.mismatched).toHaveLength(1);
    expect(r.mismatched[0].bill.id).toBe("b1");
    expect(r.mismatched[0].file.id).toBe("f1");
    expect(r.mismatched[0].gap).toBe(-40);
    // and it is NOT double-reported as an absence on either side
    expect(r.unmatchedBills).toHaveLength(0);
    expect(r.unmatchedFiles).toHaveLength(0);
  });

  it("does not invent a pair across unrelated vendors", () => {
    // Without a shared identity token these are two separate facts, and saying
    // "these disagree" about a bill and someone else's PDF would be worse than
    // reporting each as missing.
    const r = matchBackup(
      [bill({ id: "b1", cost: 500, vendor: "Fasteners Plus" })],
      [file({ id: "f1", amount: 460, tail: "Island Custom Woodworks Kevin Berger Pushed to JT" })],
    );
    expect(r.mismatched).toHaveLength(0);
    expect(r.unmatchedBills.map((b) => b.id)).toEqual(["b1"]);
    expect(r.unmatchedFiles.map((f) => f.id)).toEqual(["f1"]);
  });

  it("still separates amounts more than a cent apart", () => {
    // The tolerance absorbs a rounding cent, not a real difference. Two cents is
    // a different number and must stay unmatched, or the check stops checking.
    const r = matchBackup(
      [bill({ id: "b1", cost: 4163.75, vendor: "Island Custom Woodworks" })],
      [file({ id: "f1", amount: 4163.73, tail: "Island Custom Woodworks Kevin Berger Pushed to JT" })],
    );
    expect(r.matched.has("b1")).toBe(false);
    expect(r.mismatched).toHaveLength(1);
  });

  it("reports a bill with no PDF and a PDF with no bill separately", () => {
    // Different vendors, so there is nothing to pair them by — two separate
    // facts, reported separately.
    const r = matchBackup(
      [bill({ id: "b1", cost: 100, vendor: "Fasteners Plus" })],
      [file({ id: "f1", amount: 250, tail: "Island Custom Woodworks Ferron Pushed to JT" })],
    );
    expect(r.unmatchedBills.map((b) => b.id)).toEqual(["b1"]);
    expect(r.unmatchedFiles.map((f) => f.id)).toEqual(["f1"]);
  });
});

describe("backup coverage", () => {
  it("reports a bill disagreeing with its own backup ONCE, not as two absences", () => {
    // The office's report: the same money as "No backup filed — Fasteners Plus
    // $574.03" AND "Filed but not billed — $529.79", for a bill and the very
    // PDF backing it. One discrepancy, named once.
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", cost: 574.03, price: 574.03, priceWithTax: 574.03 })],
          bills: [
            bill({ id: "b1", cost: 574.03, taxAmount: 0, vendor: "Fasteners Plus", invoiced: true }),
          ],
          folder: {
            path: "/x/", found: true, folderId: "F", truncated: false,
            files: [
              file({ id: "f1", amount: 529.79, tail: "Fasteners Plus Kevin Berger Pushed to JT" }),
            ],
          },
        }),
      ]),
    );
    expect(kinds(f)).toContain("backup-amount-mismatch");
    expect(kinds(f)).not.toContain("backup-missing");
    expect(kinds(f)).not.toContain("backup-unmatched");
    const hit = f.find((x) => x.kind === "backup-amount-mismatch");
    expect(hit?.amount).toBeCloseTo(44.24, 2);
  });

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

  it("does not flag a draft holding the zero paid and zero balance every draft holds", () => {
    // Berger Main House invoice #12: a draft totalling $8,610.42 with
    // `amountPaid: 0, balance: 0`, which is what JobTread stores on EVERY draft
    // regardless of total (probe-confirmed org-wide 2026-09-03 — no exceptions).
    // JobTread does not compute a balance until a document is issued, so the
    // issued-invoice identity reduces to `priceWithTax - 0 - 0` here and used to
    // report the entire invoice total as the discrepancy.
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", status: "draft", issueDate: "",
              price: 7946.86, tax: 663.56, priceWithTax: 8610.42,
              amountPaid: 0, balance: 0,
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).not.toContain("math-balance");
    // The other three sums must still run on a draft. A draft is the only
    // window in which a finding can still be acted on, so nothing here may stop
    // looking at one — this asserts the tax sum really did run and pass.
    expect(kinds(f)).not.toContain("math-tax");
  });

  it("flags a draft that already carries a payment", () => {
    // The draft branch is an assertion, not an exemption: a draft is checked
    // against the state a draft is supposed to be in. No draft in the
    // organization holds a payment, so one that does is worth hearing about —
    // and it is still a draft, so it can still be fixed.
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", status: "draft", issueDate: "",
              price: 7946.86, tax: 663.56, priceWithTax: 8610.42,
              amountPaid: 500, balance: 0,
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-balance");
    expect(f.find((x) => x.kind === "math-balance")?.amount).toBe(500);
  });

  it("flags a draft that already carries a balance", () => {
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", status: "draft", issueDate: "",
              price: 7946.86, tax: 663.56, priceWithTax: 8610.42,
              amountPaid: 0, balance: 8610.42,
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-balance");
  });

  it("still flags a non-draft invoice whose balance reads zero while unpaid", () => {
    // The exemption is keyed to draft status alone. An ISSUED invoice with a
    // zero balance and nothing paid is a real problem and must survive.
    const f = runChecks(
      month([
        job({
          invoices: [
            invoice({
              id: "i1", status: "pending",
              price: 7946.86, tax: 663.56, priceWithTax: 8610.42,
              amountPaid: 0, balance: 0,
            }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("math-balance");
  });
});

describe("period & scope", () => {
  it("flags an invoice issued well after the period closed", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", issueDate: "2026-09-15" })] })]),
    );
    expect(kinds(f)).toContain("period-issue-date");
  });

  it("flags an invoice dated before the period it bills", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", issueDate: "2026-06-20" })] })]),
    );
    expect(kinds(f)).toContain("period-issue-date");
  });

  it("accepts the last day of the billing month", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", issueDate: "2026-07-31" })] })]),
    );
    expect(kinds(f)).not.toContain("period-issue-date");
  });

  it("accepts an invoice raised after the period closes on the 10th", () => {
    // The office's actual convention. deriveBillingPeriod (Config.js) puts a
    // bill received on or before the 10th into the PREVIOUS month, so July
    // billing runs ~July 11 → Aug 10 and the invoice can only go out after
    // that. Berger Bunkhouse's July invoice #221, issued 2026-08-11, was
    // reported as billing "the client for the wrong month".
    for (const issueDate of ["2026-08-01", "2026-08-11", "2026-08-31"]) {
      const f = runChecks(month([job({ invoices: [invoice({ id: "i1", issueDate })] })]));
      expect(kinds(f), `issued ${issueDate}`).not.toContain("period-issue-date");
    }
  });

  it("rolls the year for December billing", () => {
    // December billing is raised in January of the NEXT year — the window has
    // to roll with it or every December invoice fires this every year.
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1", issueDate: "2027-01-12" })] })], {
        ym: "2026-12", year: 2026, month: 12, monthLabel: "December 2026",
      }),
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

  it("explains an invoice's cost with time entries, not just bills", () => {
    // Berger Main House, August 2026: invoice #12 totalled $6,735 against one
    // $4,163.75 bill and 20 time entries worth $2,571.25. Comparing bills alone
    // called the $2,571.25 "cost from outside the month" and blamed bills that
    // did not exist — it was labor, on this invoice, this month.
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", cost: 6735, price: 6735, priceWithTax: 6735 })],
          bills: [bill({ id: "b1", cost: 4163.75, invoiceIds: ["i1"], invoiced: true })],
          labor: [labor({ id: "t1", cost: 2571.25, invoiceIds: ["i1"] })],
        }),
      ]),
    );
    expect(kinds(f)).not.toContain("math-cost-basis");
  });

  it("still flags a real gap once bills and time are both counted", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", cost: 1000, price: 1000, priceWithTax: 1000 })],
          bills: [bill({ id: "b1", cost: 400, invoiceIds: ["i1"], invoiced: true })],
          labor: [labor({ id: "t1", cost: 200, invoiceIds: ["i1"] })],
        }),
      ]),
    );
    const finding = f.find((x) => x.kind === "math-cost-basis");
    expect(finding).toBeTruthy();
    expect(finding?.amount).toBe(400);
    expect(finding?.detail).toContain("1 bill and 1 time entry");
  });

  it("does not skip a time-only invoice — no bills is not 'nothing to compare'", () => {
    // The short-circuit used to be `!onThisInvoice.length` alone, which bailed
    // before a time-only invoice's time entries ever got a chance to explain
    // the cost — the exact shape a pure-labor invoice takes.
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1", cost: 500, price: 500, priceWithTax: 500 })],
          labor: [labor({ id: "t1", cost: 500, invoiceIds: ["i1"] })],
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
          bills: [bill({ id: "b1", cost: 5000, invoiced: false })],
          draftBillCount: 1,
          draftBillsCost: 10,
        }),
      ]),
    );
    expect(f[0].severity).toBe("error");
    expect(f[0].kind).toBe("bill-uninvoiced");
  });

  it("says nothing is wrong when nothing is wrong", () => {
    const m = month([job({ invoices: [invoice({ id: "i1" })] })]);
    expect(fallbackSummary(m, runChecks(m))).toContain("nothing to flag");
  });

  it("does not count a suppressed finding as a problem", () => {
    const m = month([
      job({
        invoices: [invoice({ id: "i1" })],
        bills: [bill({ id: "b1", cost: 5000, invoiced: false })],
      }),
    ]);
    const suppressed = runChecks(m).map((f) => ({
      ...f,
      suppressedBy: { reason: "held back on purpose", by: "office", at: "", scope: "finding" as const },
    }));
    expect(fallbackSummary(m, suppressed)).toContain("nothing to flag");
  });
});

describe("the office mailbox — was every vendor invoice captured?", () => {
  const swept = (emails: BillEmail[], over = {}) =>
    month([job()], { emailChecked: true, emails, mailWindow: { first: "2026-07-11", last: "2026-08-10" }, ...over });

  it("reports nothing at all when the mailbox was not searched", () => {
    // The dangerous case: a skipped check must never read as a passed one.
    const f = runChecks(month([job()], { emails: [mail({ threadId: "t1", matchedBillId: "" })] }));
    expect(kinds(f).filter((k) => k.startsWith("email"))).toEqual([]);
  });

  it("says nothing about an invoice that did become a bill", () => {
    const f = runChecks(swept([mail({ threadId: "t1", matchedBillId: "b1" })]));
    expect(kinds(f).filter((k) => k.startsWith("email"))).toEqual([]);
  });

  it("flags an invoice that arrived and never became a bill", () => {
    const f = runChecks(swept([mail({ threadId: "t1", matchedBillId: "" })]));
    const hit = f.find((x) => x.kind === "email-bill-missed");
    expect(hit?.severity).toBe("error");
    expect(hit?.title).toContain("Reggio Register");
  });

  it("says nothing when the vendor's bills could not be read", () => {
    // No match, but nothing was searched — an unproven miss must not be an accusation.
    const f = runChecks(swept([mail({ threadId: "t1", matchedBillId: "", checked: false })]));
    expect(kinds(f).filter((k) => k.startsWith("email"))).toEqual([]);
  });

  it("files an unrecognized sender separately and more softly", () => {
    const f = runChecks(
      swept([mail({ threadId: "t1", vendorId: "", vendorName: "", matchedBillId: "", checked: false })]),
    );
    const hit = f.find((x) => x.kind === "email-unknown-sender");
    expect(hit?.severity).toBe("warning");
    expect(kinds(f)).not.toContain("email-bill-missed");
  });

  it("calls out a Processed label on an invoice JobTread never got", () => {
    const f = runChecks(
      swept([mail({ threadId: "t1", matchedBillId: "", labels: ["Processed"] })]),
    );
    const hit = f.find((x) => x.kind === "email-bill-missed");
    expect(hit?.detail).toContain("Processed");
    expect(hit?.detail).toContain("that belief is what this check exists to test");
  });

  it("carries the subject amount so the finding can be ranked by money", () => {
    const f = runChecks(swept([mail({ threadId: "t1", matchedBillId: "", subjectAmount: 8553.5 })]));
    expect(f.find((x) => x.kind === "email-bill-missed")?.amount).toBe(8553.5);
  });

  it("warns that a truncated sweep proves nothing about what it did not see", () => {
    const f = runChecks(swept([mail({ threadId: "t1" })], { mailTruncated: true }));
    const hit = f.find((x) => x.title.includes("hit its limit"));
    expect(hit?.severity).toBe("warning");
  });
});

describe("everything captured must reach an invoice", () => {
  it("names each straggler bill when the job WAS invoiced", () => {
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1" })],
          bills: [
            bill({ id: "b1", cost: 900, vendor: "Island Sash", invoiced: false }),
            bill({ id: "b2", cost: 400, vendor: "LSWDD", invoiced: false }),
            bill({ id: "b3", cost: 100, invoiced: true }),
          ],
        }),
      ]),
    );
    const hits = f.filter((x) => x.kind === "bill-uninvoiced");
    expect(hits).toHaveLength(2);
    expect(hits[0].amount).toBe(900); // worst first
  });

  it("reports a job that was never invoiced ONCE, not once per bill", () => {
    const f = runChecks(
      month([
        job({
          invoices: [],
          bills: [
            bill({ id: "b1", cost: 900, invoiced: false }),
            bill({ id: "b2", cost: 400, invoiced: false }),
          ],
        }),
      ]),
    );
    expect(kinds(f)).toContain("job-not-invoiced");
    expect(kinds(f)).not.toContain("bill-uninvoiced");
    expect(f.find((x) => x.kind === "job-not-invoiced")?.amount).toBe(1300);
  });

  it("ignores sub-dollar remainders as rounding", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1" })], bills: [bill({ id: "b1", cost: 0.02, invoiced: false })] })]),
    );
    expect(kinds(f)).not.toContain("bill-uninvoiced");
  });

  it("still reports uninvoiced labor, which has no per-bill equivalent", () => {
    const f = runChecks(
      month([job({ invoices: [invoice({ id: "i1" })], uninvoicedTimeCost: 1200 })]),
    );
    const hit = f.find((x) => x.kind === "scope-uninvoiced");
    expect(hit?.title).toContain("labor");
  });
});

describe("Office and Shop are never invoiced", () => {
  const overhead = (name: string, id = "JX") =>
    job({
      jobId: id,
      jobName: name,
      customerName: "Ascent",
      neverInvoiced: isNeverInvoiced(id, name),
      bills: [bill({ id: "b1", cost: 5000, invoiced: false })],
      uninvoicedTimeCost: 2000,
      draftBillCount: 3,
      draftBillsCost: 800,
    });

  it("recognizes Office and Shop by name, and Office by its known id", () => {
    expect(isNeverInvoiced("JX", "Office")).toBe(true);
    expect(isNeverInvoiced("JX", "shop")).toBe(true);
    expect(isNeverInvoiced("22PXevQbM9FQ", "whatever it gets renamed to")).toBe(true);
  });

  it("does not mistake a real job whose name merely contains Office", () => {
    // "Office Remodel" for a paying customer is a real job and MUST be billed.
    expect(isNeverInvoiced("JX", "Office Remodel")).toBe(false);
  });

  it("raises no billing findings against them", () => {
    for (const name of ["Office", "Shop"]) {
      const f = runChecks(month([overhead(name)]));
      expect(kinds(f)).not.toContain("job-not-invoiced");
      expect(kinds(f)).not.toContain("bill-uninvoiced");
      expect(kinds(f)).not.toContain("scope-uninvoiced");
      expect(kinds(f)).not.toContain("scope-drafts");
    }
  });

  it("but DOES raise them against an ordinary job with the same shape", () => {
    const f = runChecks(month([{ ...overhead("Kitchen Remodel"), neverInvoiced: false }]));
    expect(kinds(f)).toContain("job-not-invoiced");
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
    const m = month([
      job({
        invoices: [invoice({ id: "i1" })],
        bills: [bill({ id: "b1", cost: 5000, vendor: "Island Sash", invoiced: false })],
      }),
    ]);
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

describe("the links a finding hands the office", () => {
  it("carries jobId on a bill link so the page's pager works on arrival", () => {
    // The page reads the doc id from the PATH and the job id from the QUERY.
    // /api/bill can now recover the job from the bill when jobId is absent, so a
    // link without it still opens — but we pass it anyway to power the page's
    // coding-queue pager and Back link without an extra lookup.
    expect(billLink("J1", "b1")).toBe("/bill/b1?jobId=J1");
  });

  it("escapes both ids", () => {
    expect(billLink("J/1", "b 1")).toBe("/bill/b%201?jobId=J%2F1");
  });

  it("omits the query rather than sending an empty jobId", () => {
    expect(billLink("", "b1")).toBe("/bill/b1");
  });

  it("gives every bill-level finding a usable link", () => {
    // Guards all three checks at once: a bill link with no jobId is dead.
    const f = runChecks(
      month([
        job({
          invoices: [invoice({ id: "i1" })],
          bills: [
            bill({ id: "b1", cost: 900, invoiced: false }),
            bill({ id: "b2", cost: 400, invoiceIds: ["i1", "i2"] }),
          ],
        }),
      ]),
    );
    const billLinks = f.map((x) => x.sourceLink).filter((l) => l?.startsWith("/bill/"));
    expect(billLinks.length).toBeGreaterThan(0);
    for (const l of billLinks) expect(l).toContain("jobId=");
  });
});
