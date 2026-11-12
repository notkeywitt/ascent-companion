/**
 * The month's Invoicing Package EMAIL — the list the office sends once the
 * month's client invoices are in QuickBooks: one block per job — its name in
 * the amber heading, its note as bullets (one per paragraph), then a LINKS list
 * of the tracking sheet and its PDF, the Drive folder, the job's Invoicing
 * Summary PDF, and each invoice in JobTread and QuickBooks. Nothing is attached: every
 * PDF is an inline link. Modelled on the Monthly Invoice Package Email doc.
 *
 * Pure: the route (`/api/invoicing-summary/email`) gathers the inputs, and
 * Apps Script (`_companionDraftInvoicingEmail`) turns each `sheetpdf:N` link
 * (the tracking sheet's PDF export, which needs the tab's gid) and each
 * `summarypdf:<jobId>` link (the job's summary, rendered to PDF and filed in
 * its billing folder) into the real URL and saves the Gmail draft. The office reads and sends the draft by hand.
 */
import type { PackageInvoice } from "./jobtread";
import { jobInvoices, jtDocumentUrl } from "./packageInvoices";

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
  /** The PRIMARY invoice's number — the whole list is `invoices`. */
  invoiceNumber: string;
  /** Every invoice for the month, primary first (packageInvoices.ts). Absent
   *  from an older Apps Script payload. */
  invoices?: unknown;
  trackingSheetUrl: string;
  /** The job's folder in the month's billing tree on Drive; "" when not found. */
  billingFolderUrl?: string;
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

/** The amber of the headings in the template doc (#BF9000). */
const AMBER = "#BF9000";
const amber = (html: string) => `<span style="color:${AMBER}">${html}</span>`;

/** The job's note, one bullet per paragraph break. */
export const noteBullets = (note: string) =>
  note
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function composeInvoicingEmail({
  docTitle,
  monthName,
  summaryJobIds,
  jobs,
  invoices,
  phases,
}: {
  /** "October '26 Invoicing Package" — the subject, same name as the doc. */
  docTitle: string;
  /** "October" — the month the invoices go out in. */
  monthName: string;
  /** Jobs whose Invoicing Summary PDF the route is rendering: each gets its link. */
  summaryJobIds: string[];
  jobs: PackageJob[];
  /** `${jobId}:${invoiceNumber}` → the invoice (getInvoiceRefs). */
  invoices: Record<string, PackageInvoice>;
  /** jobId → JobTread Phase (getJobPhaseMap). */
  phases: Record<string, string>;
}): {
  subject: string;
  html: string;
  /** One per `sheetpdf:N` link in the html, N = index. Apps Script resolves each. */
  sheetPdfLinks: { url: string; tab: string }[];
} {
  // Invoiced jobs first, the rest after with their notes — the October order.
  const included = jobs.filter((j) => j.include);
  const invoiced = (j: PackageJob) => jobInvoices(j).length > 0;
  const ordered = [...included.filter(invoiced), ...included.filter((j) => !invoiced(j))];

  const sheetPdfLinks: { url: string; tab: string }[] = [];
  const blocks = ordered.map((j) => {
    const precon = PRECON_PHASES.includes(phases[j.jtJobId] ?? "");
    const tab = precon ? "Pre-con" : "Tracking Sheet";
    const bullets = noteBullets(j.note);
    const ivs = jobInvoices(j);
    if (!bullets.length && !ivs.length) bullets.push("No client invoice yet.");

    const links: string[] = [];
    if (j.trackingSheetUrl) {
      links.push(a(j.trackingSheetUrl, precon ? "Google Tracking Sheet (Pre-con tab)" : "Google Tracking Sheet"));
      links.push(a(`sheetpdf:${sheetPdfLinks.length}`, "Google Tracking Sheet PDF"));
      sheetPdfLinks.push({ url: j.trackingSheetUrl, tab });
    }
    if (j.billingFolderUrl) links.push(a(j.billingFolderUrl, "Google Drive"));
    if (summaryJobIds.includes(j.jtJobId)) links.push(a(`summarypdf:${j.jtJobId}`, "Invoicing Summary PDF"));
    // Every invoice of the month — a job can have two: the normal one and a
    // $0 warranty record (src/lib/warranty.ts). Each gets its JobTread and QBO link.
    for (const iv of ivs) {
      const inv = iv.number ? invoices[`${j.jtJobId}:${iv.number}`] : undefined;
      const id = iv.id || inv?.id;
      const tag = iv.warranty ? " (warranty record, $0)" : "";
      links.push(a(id ? jtDocumentUrl(j.jtJobId, id) : j.links.jtInvoice, `JobTread invoice #${iv.number}`) + esc(tag));
      links.push(
        inv?.qboId
          ? a(`https://qbo.intuit.com/app/invoice?txnId=${inv.qboId}`, `QBO Invoice #${iv.number}`)
          : `QBO Invoice #${esc(iv.number)} — not pushed to QuickBooks yet`,
      );
    }

    return (
      `<div><b>${amber(`${esc(j.customerLabel)} - ${esc(j.jobLabel)}`)}</b></div>` +
      (bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "") +
      `<div style="margin-left:36px"><b>${amber("LINKS")}</b><br>${links.join("<br>")}</div><br>`
    );
  });

  const html =
    `<div>Hello,</div><br>` +
    `<div>Below are links to the customer invoices in QBO for ${esc(monthName)}, along with the ` +
    `JobTread invoice, the Invoicing Summary PDF and each job's tracking sheet and its PDF.</div><br>` +
    `<div>Thanks!</div><br>` +
    blocks.join("") +
    `<div>-Keillor</div><br>` +
    `<div><i>Office &amp; Administration</i></div><div><b>Ascent Building Co. LLC</b></div>` +
    `<div>PO Box 664</div><div>Lopez Island, WA 98261</div><div>(360) 209 4033</div>`;

  return { subject: docTitle, html, sheetPdfLinks };
}
