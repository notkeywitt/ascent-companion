import { InvoiceReview } from "./InvoiceReview";

/**
 * Monthly client-invoice review — cross-check a billing month's client invoices
 * against the vendor bills behind them and the backup PDFs filed in Drive.
 *
 * All data comes from one server route (/api/invoice-review), which is where the
 * JobTread grant key and the Apps Script secret stay. Nothing here needs
 * injecting, so the server half is just the gate (the "invoice-review" view in
 * src/lib/views.ts) and this shell.
 */
export default function InvoiceReviewPage() {
  return <InvoiceReview />;
}
