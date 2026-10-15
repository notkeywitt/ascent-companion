/**
 * The month's Invoicing Package EMAIL — the list the office sends once the
 * month's client invoices are in QuickBooks: one item per job, linking its
 * tracking sheet, its QuickBooks invoice and its JobTread invoice. Each tracking sheet (the file Ty
 * attaches to the client follow-ups) and each JobTread invoice is attached as
 * a PDF. Modelled on the October '26 package, sent 2026-10-14.
 *
 * Pure: the route (`/api/invoicing-summary/email`) gathers the inputs, and
 * Apps Script (`_companionDraftInvoicingEmail`) fetches the PDFs and saves the
 * Gmail draft. The office reads and sends the draft by hand.
 */
import type { PackageInvoice } from "./jobtread";

export const PACKAGE_EMAIL_TO = [
  "casey@ascentbuildingco.com",
  "ty@ascentbuildingco.com",
  "booksbysara@hotmail.com",
  "tommy@ascentbuildingco.com",
];

/** A precon job's figures live on the sheet's Pre-con tab, not the Tracking Sheet tab. */
export const PRECON_PHASES = ["PreCon", "PreCon Budget"];

/** The fields of one /invoicing-summary job that the email reads. */
export interface PackageJob {
  jtJobId: string;
  customerLabel: string;
  jobLabel: string;
  include: boolean;
  note: string;
  invoiceNumber: string;
  trackingSheetUrl: string;
  links: { jtInvoice: string; jtDocuments: string };
}

export interface SheetPdf {
  url: string;
  tab: string;
  name: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;

export function composeInvoicingEmail({
  docTitle,
  monthName,
  jobs,
  invoices,
  phases,
}: {
  /** "October '26 Invoicing Package" — the subject, same name as the doc. */
  docTitle: string;
  /** "October" — the month the invoices go out in. */
  monthName: string;
  jobs: PackageJob[];
  /** `${jobId}:${invoiceNumber}` → the invoice (getInvoiceRefs). */
  invoices: Record<string, PackageInvoice>;
  /** jobId → JobTread Phase (getJobPhaseMap). */
  phases: Record<string, string>;
}): {
  subject: string;
  html: string;
  sheets: SheetPdf[];
  invoices: { id: string; name: string }[];
} {
  // Invoiced jobs first, the rest after with their notes — the October order.
  const included = jobs.filter((j) => j.include);
  const ordered = [
    ...included.filter((j) => j.invoiceNumber),
    ...included.filter((j) => !j.invoiceNumber),
  ];

  const sheets: SheetPdf[] = [];
  const pdfs: { id: string; name: string }[] = [];
  const items = ordered.map((j) => {
    const precon = PRECON_PHASES.includes(phases[j.jtJobId] ?? "");
    const tab = precon ? "Pre-con" : "Tracking Sheet";
    if (j.trackingSheetUrl) {
      sheets.push({
        url: j.trackingSheetUrl,
        tab,
        name: `${j.customerLabel} - ${j.jobLabel} - ${tab}.pdf`.replace(/[\\/]/g, "-"),
      });
    }
    const head =
      a(j.trackingSheetUrl || j.links.jtDocuments, j.jobLabel) +
      ` - ${esc(j.customerLabel)}` +
      (precon && j.trackingSheetUrl ? " <b>(PRE-CON tab)</b>" : "");

    const subs: string[] = [];
    const inv = j.invoiceNumber ? invoices[`${j.jtJobId}:${j.invoiceNumber}`] : undefined;
    if (j.invoiceNumber) {
      subs.push(
        inv?.qboId
          ? a(`https://qbo.intuit.com/app/invoice?txnId=${inv.qboId}`, "QBO")
          : "QBO — not pushed to QuickBooks yet",
      );
      subs.push(a(j.links.jtInvoice, `JobTread invoice #${j.invoiceNumber}`));
    }
    if (inv) {
      pdfs.push({ id: inv.id, name: inv.pdfName });
      subs.push(`${esc(inv.pdfName)} (attached)`);
    }
    if (j.note) subs.push(esc(j.note));
    if (!subs.length) subs.push("No client invoice yet.");

    return `<li>${head}<ol>${subs.map((s) => `<li>${s}</li>`).join("")}</ol></li>`;
  });

  const html =
    `<div>Hello,</div><br>` +
    `<div>Below are links to the customer invoices in QBO for ${esc(monthName)}, along with the ` +
    `JobTread invoice PDF and each job's tracking sheet. Both are attached as PDFs.</div><br>` +
    `<div>Thanks!</div><br>` +
    `<ol>${items.join("")}</ol><br>` +
    `<div>-Keillor</div><br>` +
    `<div><i>Office &amp; Administration</i></div><div><b>Ascent Building Co. LLC</b></div>` +
    `<div>PO Box 664</div><div>Lopez Island, WA 98261</div><div>(360) 209 4033</div>`;

  return { subject: docTitle, html, sheets, invoices: pdfs };
}
