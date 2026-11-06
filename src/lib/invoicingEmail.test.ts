import { describe, expect, it } from "vitest";
import { composeInvoicingEmail, type PackageJob } from "./invoicingEmail";

const job = (over: Partial<PackageJob>): PackageJob => ({
  jtJobId: "j1",
  customerLabel: "Kevin Berger & Alexis Takacs",
  jobLabel: "Berger Addition",
  include: true,
  note: "",
  invoiceNumber: "379",
  trackingSheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit",
  links: { jtInvoice: "https://app.jobtread.com/jobs/j1/documents/d1", jtDocuments: "https://app.jobtread.com/jobs/j1/documents" },
  ...over,
});

describe("composeInvoicingEmail", () => {
  const out = composeInvoicingEmail({
    docTitle: "October '26 Invoicing Package",
    monthName: "October '26",
    jobs: [
      job({ jtJobId: "shack", jobLabel: "Beach Shack", invoiceNumber: "", trackingSheetUrl: "", note: "Keillor will send a progress invoice." }),
      job({}),
      job({ jtJobId: "moon", jobLabel: "Main House/Precon", invoiceNumber: "22" }),
      job({ jtJobId: "office", jobLabel: "Office", include: false }),
    ],
    invoices: {
      "j1:379": { id: "d379", qboId: "46097", pdfName: "Monthly Invoice 002-379.pdf" },
      "moon:22": { id: "d22", qboId: "", pdfName: "Monthly Invoice 22-22.pdf" },
    },
    phases: { moon: "PreCon" },
  });

  it("links QBO by txnId, and says so when the invoice is not in QuickBooks", () => {
    expect(out.html).toContain('href="https://qbo.intuit.com/app/invoice?txnId=46097"');
    expect(out.html).toContain("QBO — not pushed to QuickBooks yet");
  });

  it("links each JobTread invoice and attaches its PDF", () => {
    expect(out.invoices).toEqual([
      { id: "d379", name: "Monthly Invoice 002-379.pdf" },
      { id: "d22", name: "Monthly Invoice 22-22.pdf" },
    ]);
    expect(out.html).toContain("Monthly Invoice 002-379.pdf (attached)");
    expect(out.html).toContain('href="https://app.jobtread.com/jobs/j1/documents/d1">JobTread invoice #379</a>');
  });

  it("attaches the Pre-con tab for a precon job and the Tracking Sheet tab otherwise", () => {
    expect(out.sheets).toEqual([
      { url: "https://docs.google.com/spreadsheets/d/abc/edit", tab: "Tracking Sheet", name: "Kevin Berger & Alexis Takacs - Berger Addition - Tracking Sheet.pdf" },
      { url: "https://docs.google.com/spreadsheets/d/abc/edit", tab: "Pre-con", name: "Kevin Berger & Alexis Takacs - Main House-Precon - Pre-con.pdf" },
    ]);
    expect(out.html).toContain("(PRE-CON tab)");
  });

  it("puts invoiced jobs first, keeps a note, drops excluded jobs, escapes labels", () => {
    expect(out.html.indexOf("Berger Addition")).toBeLessThan(out.html.indexOf("Beach Shack"));
    expect(out.html).toContain("Keillor will send a progress invoice.");
    expect(out.html).not.toContain(">Office<");
    expect(out.html).toContain("Kevin Berger &amp; Alexis Takacs");
    expect(out.subject).toBe("October '26 Invoicing Package");
  });
});

describe("composeInvoicingEmail — two invoices in one month (Seely, October 2026)", () => {
  const out = composeInvoicingEmail({
    docTitle: "November '26 Invoicing Package",
    monthName: "November '26",
    jobs: [
      job({
        jtJobId: "seely",
        jobLabel: "Apartment Remod",
        customerLabel: "Seely",
        invoiceNumber: "134",
        invoices: [
          { id: "d134", number: "134", status: "pending", balance: 0, priceWithTax: 1700, warranty: false },
          { id: "d130", number: "130", status: "pending", balance: 0, priceWithTax: 0, warranty: true },
        ],
      }),
    ],
    invoices: {
      "seely:134": { id: "d134", qboId: "50001", pdfName: "Monthly Invoice 009-134.pdf" },
      "seely:130": { id: "d130", qboId: "", pdfName: "Monthly Invoice 009-130.pdf" },
    },
    phases: {},
  });

  it("attaches both PDFs, the normal invoice first", () => {
    expect(out.invoices).toEqual([
      { id: "d134", name: "Monthly Invoice 009-134.pdf" },
      { id: "d130", name: "Monthly Invoice 009-130.pdf" },
    ]);
  });

  it("links each invoice and marks the warranty record", () => {
    expect(out.html).toContain('href="https://app.jobtread.com/jobs/seely/documents/d134">JobTread invoice #134</a>');
    expect(out.html).toContain('href="https://app.jobtread.com/jobs/seely/documents/d130">JobTread invoice #130</a> (warranty record, $0)');
    expect(out.html).toContain('txnId=50001');
    expect(out.html).toContain("QBO — warranty — not pushed to QuickBooks yet");
  });
});
