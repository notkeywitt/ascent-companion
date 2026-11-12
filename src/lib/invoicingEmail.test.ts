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
    summaryJobIds: ["j1", "moon"],
    jobs: [
      job({ jtJobId: "shack", jobLabel: "Beach Shack", invoiceNumber: "", trackingSheetUrl: "", note: "Keillor will send a progress invoice." }),
      job({ note: "First point.\n\nSecond point.\r\n  Third & last.  " , billingFolderUrl: "https://drive.google.com/drive/folders/f1" }),
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
    expect(out.html).toContain('href="https://qbo.intuit.com/app/invoice?txnId=46097">QBO Invoice #379</a>');
    expect(out.html).toContain("QBO Invoice #22 — not pushed to QuickBooks yet");
  });

  it("links each JobTread invoice, and attaches nothing", () => {
    expect(out.html).toContain('href="https://app.jobtread.com/jobs/j1/documents/d1">JobTread invoice #379</a>');
    expect(out.html).not.toContain("(attached)");
    expect(out).not.toHaveProperty("invoices");
  });

  it("links the tracking sheet, its PDF (resolved by Apps Script), the Drive folder and the summary PDF", () => {
    expect(out.html).toContain('href="https://docs.google.com/spreadsheets/d/abc/edit">Google Tracking Sheet</a>');
    expect(out.html).toContain('href="sheetpdf:0">Google Tracking Sheet PDF</a>');
    expect(out.html).toContain('href="sheetpdf:1">Google Tracking Sheet PDF</a>');
    expect(out.html).toContain('href="https://drive.google.com/drive/folders/f1">Google Drive</a>');
    expect(out.html).toContain('href="summarypdf:j1">Invoicing Summary PDF</a>');
    expect(out.sheetPdfLinks).toEqual([
      { url: "https://docs.google.com/spreadsheets/d/abc/edit", tab: "Tracking Sheet" },
      { url: "https://docs.google.com/spreadsheets/d/abc/edit", tab: "Pre-con" },
    ]);
    expect(out.html).toContain("Google Tracking Sheet (Pre-con tab)");
  });

  it("makes one bullet per paragraph of the note, under an amber customer - job heading", () => {
    expect(out.html).toContain("<ul><li>First point.</li><li>Second point.</li><li>Third &amp; last.</li></ul>");
    expect(out.html).toContain("Kevin Berger &amp; Alexis Takacs - Berger Addition</span></b>");
    expect(out.html).toContain("LINKS");
  });

  it("puts invoiced jobs first, keeps a note, drops excluded jobs", () => {
    expect(out.html.indexOf("Berger Addition")).toBeLessThan(out.html.indexOf("Beach Shack"));
    expect(out.html).toContain("<li>Keillor will send a progress invoice.</li>");
    expect(out.html).not.toContain("Office</span>");
    expect(out.subject).toBe("October '26 Invoicing Package");
    expect(out.html.startsWith("<div>October '26 Invoicing Package - For Review</div>")).toBe(true);
    expect(out.html).not.toContain("Hello,");
  });

  it("leaves the summary link out of a job with no summary PDF", () => {
    const none = composeInvoicingEmail({ docTitle: "t", summaryJobIds: [], jobs: [job({})], invoices: {}, phases: {} });
    expect(none.html).not.toContain("Invoicing Summary PDF</a>");
  });
});

describe("composeInvoicingEmail — two invoices in one month (Seely, October 2026)", () => {
  const out = composeInvoicingEmail({
    docTitle: "November '26 Invoicing Package",
    summaryJobIds: ["j1", "moon"],
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

  it("links each invoice, the normal one first, and marks the warranty record", () => {
    expect(out.html.indexOf("#134")).toBeLessThan(out.html.indexOf("#130"));
    expect(out.html).toContain('href="https://app.jobtread.com/jobs/seely/documents/d134">JobTread invoice #134</a>');
    expect(out.html).toContain('href="https://app.jobtread.com/jobs/seely/documents/d130">JobTread invoice #130</a> (warranty record, $0)');
    expect(out.html).toContain('txnId=50001');
    expect(out.html).toContain("QBO Invoice #130 — not pushed to QuickBooks yet");
  });
});
