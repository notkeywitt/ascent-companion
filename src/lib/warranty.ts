/**
 * Warranty work — Ascent's own cost, never billed to the client.
 *
 * Bills and time coded 88 90 00 stay OUT of every per-job figure: TO BE
 * INVOICED, a job's month total, its cost rings. They stay IN the all-jobs
 * month totals, as a "Warranty Work" slice of their own.
 *
 * KEEP IN SYNC with TRACKING_WARRANTY_CSI in ascent-appscript/TrackingSheets.js,
 * which applies the same rule to the tracking sheets and the Invoicing Package.
 */

/** The cost code for warranty work (JT cost code 22PgDDHtNfu8 "Warranty Work"). */
export const WARRANTY_CSI = "88 90 00";

/** The all-jobs rings' slice key for warranty work. Never a job id. */
export const WARRANTY_SLICE_KEY = "__warranty";

/** The two figures a warranty rule reads from an invoice line. */
interface CodedLine {
  code: string;
  cost: number;
  price: number;
}

const isWarrantyCode = (code: string) => String(code ?? "").trim() === WARRANTY_CSI;

/**
 * Is this client invoice a WARRANTY RECORD rather than a bill to the client?
 *
 * The owner's rule (2026-11, Seely / Apartment Remod #130): warranty work Ascent
 * pays for goes on its own invoice, every line coded 88 90 00 and priced $0. It
 * sits beside the month's normal invoice, so a job can have two in one month.
 *
 * True when the invoice bills nothing and every line that carries cost or price
 * is on 88 90 00. An invoice with no such line is not a warranty record.
 *
 * KEEP IN SYNC with _misIsWarrantyInvoice in ascent-appscript/MonthlyInvoicingSummary.js.
 */
export function isWarrantyInvoice(inv: { price: number; lines?: CodedLine[] }): boolean {
  if (Math.abs(inv.price ?? 0) >= 0.005) return false;
  const live = (inv.lines ?? []).filter(
    (l) => Math.abs(l.cost ?? 0) >= 0.005 || Math.abs(l.price ?? 0) >= 0.005,
  );
  return live.length > 0 && live.every((l) => isWarrantyCode(l.code));
}

/**
 * The warranty part of an invoice's cost and price: the sum of its 88 90 00
 * lines. Every markup figure takes it out, the way it takes out a deposit —
 * warranty cost is billed at $0, so leaving it in drags a customer's rate down.
 */
export function warrantyPart(inv: { lines?: CodedLine[] }): { cost: number; price: number } {
  let cost = 0;
  let price = 0;
  for (const l of inv.lines ?? []) {
    if (!isWarrantyCode(l.code)) continue;
    cost += l.cost ?? 0;
    price += l.price ?? 0;
  }
  return { cost: Math.round(cost * 100) / 100, price: Math.round(price * 100) / 100 };
}
