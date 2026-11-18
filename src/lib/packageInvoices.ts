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
  /** From the live JobTread read (`/api/invoicing-summary`), when it answered:
   *  the title, the description, the cost basis and the pre-tax price. */
  name?: string;
  description?: string;
  cost?: number;
  price?: number;
}

/** What one invoice adds to its cost: "P&O 20.7%", "At cost, no P&O", or ""
 *  when the cost is not known or the invoice is a warranty record. */
export function invoiceMarkup(i: Pick<PackageJobInvoice, "cost" | "price" | "warranty">): {
  atCost: boolean;
  label: string;
} {
  const cost = Number(i.cost) || 0;
  const price = Number(i.price) || 0;
  if (i.warranty || cost <= 0 || price <= 0) return { atCost: false, label: "" };
  if (Math.abs(Math.round(price * 100) - Math.round(cost * 100)) <= 1) {
    return { atCost: true, label: "At cost, no P&O" };
  }
  return { atCost: false, label: `P&O ${((price / cost - 1) * 100).toFixed(1)}%` };
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
