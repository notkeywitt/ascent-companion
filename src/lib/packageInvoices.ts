/**
 * A job's client invoices for the month, as the Invoicing Package payload
 * (appscript `MonthlyInvoicingSummary.js`) sends them.
 *
 * A month can hold TWO invoices on one job: the normal one and a $0 warranty
 * record (src/lib/warranty.ts; Seely / Apartment Remod #134 + #130, October
 * 2026). The payload's `invoices` list carries every one, primary first. An
 * older Apps Script deploy sends only `invoiceNumber` / `invoiceStatus` /
 * `invoiceBalance` and the `links.jtInvoice` URL; this reads either shape.
 *
 * Pure.
 */

export interface PackageJobInvoice {
  id: string;
  number: string;
  status: string;
  balance: number;
  priceWithTax: number;
  /** A $0 warranty record rather than a bill to the client. */
  warranty: boolean;
}

/** The payload fields this reads. Every one is optional: the payload is JSON. */
export interface PackageJobInvoiceSource {
  jtJobId?: string;
  invoiceNumber?: unknown;
  invoiceStatus?: unknown;
  invoiceBalance?: unknown;
  invoices?: unknown;
  links?: { jtInvoice?: string };
}

/** The document id at the end of a JobTread document URL, or "". */
function docIdFromUrl(url: string | undefined): string {
  const m = /\/documents\/([^/?#]+)/.exec(String(url ?? ""));
  return m ? decodeURIComponent(m[1]) : "";
}

export function jobInvoices(j: PackageJobInvoiceSource): PackageJobInvoice[] {
  if (Array.isArray(j.invoices)) {
    return (j.invoices as Record<string, unknown>[])
      .filter((i) => i && (i.id || i.number))
      .map((i) => ({
        id: String(i.id ?? ""),
        number: i.number == null ? "" : String(i.number),
        status: String(i.status ?? ""),
        balance: Number(i.balance) || 0,
        priceWithTax: Number(i.priceWithTax) || 0,
        warranty: i.warranty === true,
      }));
  }
  const number = j.invoiceNumber == null ? "" : String(j.invoiceNumber);
  if (!number) return [];
  return [
    {
      id: docIdFromUrl(j.links?.jtInvoice),
      number,
      status: String(j.invoiceStatus ?? ""),
      balance: Number(j.invoiceBalance) || 0,
      priceWithTax: 0,
      warranty: false,
    },
  ];
}

/** The JobTread page for one of a job's documents. */
export function jtDocumentUrl(jobId: string, docId: string): string {
  return `https://app.jobtread.com/jobs/${encodeURIComponent(jobId)}/documents/${encodeURIComponent(docId)}`;
}
