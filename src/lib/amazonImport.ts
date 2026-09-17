/**
 * Amazon Business monthly order report → JobTread vendor bills.
 *
 * Amazon Business lets you export a CSV of every order line for a date range.
 * Each ROW is one product line; multiple rows share an `Order ID`. The office
 * types the job into the `PO Number` box at checkout (e.g. "Ferron - Masonry",
 * "Gormley", "Berger", "SHOP"), so that column is the human's hint about which
 * job an order belongs to.
 *
 * This module is the pure, dependency-free parser: raw CSV text → one
 * `AmazonOrder` per Order ID, with its product lines. The page turns each order
 * into a coded bill; the API route creates them. Keeping the parser here means
 * the page and the route share one set of types.
 */

/** One product line within an order (one CSV row). */
export interface AmazonLine {
  title: string; // product Title
  asin: string;
  quantity: number; // Item Quantity
  ppu: number; // Purchase PPU — the pre-tax unit price
  subtotal: number; // Item Subtotal — pre-tax extended (= ppu × quantity)
  tax: number; // Item Tax
  netTotal: number; // Item Net Total — subtotal + tax
  category: string; // Amazon-Internal Product Category (a hint, NOT a CSI code)
  seller: string; // Seller Name
}

/** One Amazon order = one candidate vendor bill. */
export interface AmazonOrder {
  orderId: string; // Order ID — Amazon's natural key (→ externalId AMZ-<id>)
  orderDate: string; // Order Date, MM/DD/YYYY as printed
  orderMonth: number; // 1..12, parsed from Order Date (billing-month default)
  orderYear: number;
  poNumber: string; // PO Number — the job hint the office typed
  accountUser: string; // who placed the order
  paymentDate: string; // Payment Date (for reference)
  cardLast4: string; // Payment Identifier, e.g. "1468"
  subtotal: number; // Order Subtotal — pre-tax, items only
  shipping: number; // Order Shipping & Handling — its own bill line, never folded in
  promotion: number; // Order Promotion — NEGATIVE when a discount applied
  tax: number; // Order Tax → its own 88 80 00 sales-tax line on the bill
  netTotal: number; // Order Net Total — the bill amount (subtotal + shipping + promotion + tax)
  lines: AmazonLine[];
  /** True when the document shows the card was actually charged. CSV rows always
   *  are; a PDF for an unshipped order is not, and must not become a bill. */
  charged: boolean;
}

/**
 * RFC-4180-ish CSV parse: handles quoted fields with embedded commas/newlines
 * and doubled "" escapes, plus a leading UTF-8 BOM. Returns rows of raw string
 * cells (no trimming — that's the caller's job via `unwrap`).
 */
function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore — handled by the \n branch
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Amazon exports some cells as Excel formulas (`="1468"`, `="14111507"`).
 *  After CSV parsing that surfaces as `=1468`; strip the leading `=` and any
 *  stray wrapping quotes, then trim. */
function unwrap(s: string | undefined): string {
  return String(s ?? "")
    .replace(/^=/, "")
    .replace(/^"(.*)"$/, "$1")
    .trim();
}

/** Parse a money-ish string ("17.99", "$1,234.50") to a number; blank → 0. */
function money(s: string | undefined): number {
  const n = parseFloat(unwrap(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Parse an Amazon MM/DD/YYYY date to its 1-based month/year (0 on failure). */
function monthYear(dateStr: string): { month: number; year: number } {
  const m = unwrap(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return { month: 0, year: 0 };
  return { month: parseInt(m[1], 10), year: parseInt(m[3], 10) };
}

/** Column headers we read, mapped to a normalized key. */
const COLS = {
  orderDate: "Order Date",
  orderId: "Order ID",
  poNumber: "PO Number",
  orderSubtotal: "Order Subtotal",
  orderShipping: "Order Shipping & Handling",
  orderPromotion: "Order Promotion",
  orderTax: "Order Tax",
  orderNetTotal: "Order Net Total",
  accountUser: "Account User",
  paymentDate: "Payment Date",
  cardLast4: "Payment Identifier",
  asin: "ASIN",
  title: "Title",
  category: "Amazon-Internal Product Category",
  seller: "Seller Name",
  itemQty: "Item Quantity",
  purchasePpu: "Purchase PPU",
  itemSubtotal: "Item Subtotal",
  itemTax: "Item Tax",
  itemNetTotal: "Item Net Total",
} as const;

export interface ParseResult {
  orders: AmazonOrder[];
  /** Non-fatal notes (e.g. "unrecognized header" or dropped rows). */
  warnings: string[];
}

/**
 * Parse a full Amazon Business order-report CSV into orders. Rows are grouped by
 * Order ID (order-level fields taken from each order's first row); every row
 * becomes a product line. Tax defaults to the order-level Order Tax, falling back
 * to the sum of the line taxes. Orders come back sorted by order date ascending.
 */
export function parseAmazonCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return { orders: [], warnings: ["No data rows found in the file."] };

  const header = rows[0].map((h) => unwrap(h));
  const idx: Record<string, number> = {};
  for (const [key, label] of Object.entries(COLS)) {
    const i = header.findIndex((h) => h.toLowerCase() === label.toLowerCase());
    idx[key] = i;
  }
  if (idx.orderId < 0 || idx.orderNetTotal < 0) {
    return {
      orders: [],
      warnings: [
        "This doesn't look like an Amazon Business order report — missing the Order ID / Order Net Total columns.",
      ],
    };
  }

  const get = (row: string[], key: keyof typeof COLS): string =>
    idx[key] >= 0 ? unwrap(row[idx[key]]) : "";

  const byOrder = new Map<string, AmazonOrder>();
  let dropped = 0;
  for (const row of rows.slice(1)) {
    const orderId = get(row, "orderId");
    if (!orderId) {
      dropped++;
      continue;
    }
    let order = byOrder.get(orderId);
    if (!order) {
      const { month, year } = monthYear(get(row, "orderDate"));
      order = {
        orderId,
        orderDate: get(row, "orderDate"),
        orderMonth: month,
        orderYear: year,
        poNumber: get(row, "poNumber"),
        accountUser: get(row, "accountUser"),
        paymentDate: get(row, "paymentDate"),
        cardLast4: get(row, "cardLast4"),
        subtotal: money(row[idx.orderSubtotal]),
        shipping: money(row[idx.orderShipping]),
        promotion: money(row[idx.orderPromotion]),
        tax: money(row[idx.orderTax]),
        netTotal: money(row[idx.orderNetTotal]),
        lines: [],
        charged: true,
      };
      byOrder.set(orderId, order);
    }
    order.lines.push({
      title: get(row, "title") || "Amazon item",
      asin: get(row, "asin"),
      quantity: money(row[idx.itemQty]) || 1,
      ppu: money(row[idx.purchasePpu]),
      subtotal: money(row[idx.itemSubtotal]),
      tax: money(row[idx.itemTax]),
      netTotal: money(row[idx.itemNetTotal]),
      category: get(row, "category"),
      seller: get(row, "seller"),
    });
  }
  if (dropped) warnings.push(`Skipped ${dropped} row(s) with no Order ID.`);

  const orders = [...byOrder.values()];
  for (const o of orders) {
    // Fall back to summing line taxes if the order-level tax column was blank.
    if (o.tax === 0) o.tax = o.lines.reduce((s, l) => s + l.tax, 0);
    const off = reconcileGap(o);
    if (off) warnings.push(`Order ${o.orderId}: lines + shipping + promotion + tax is ${off} off the order total.`);
  }
  orders.sort((a, b) => {
    const ta = new Date(a.orderDate).getTime() || 0;
    const tb = new Date(b.orderDate).getTime() || 0;
    return ta - tb;
  });
  return { orders, warnings };
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The charges an Amazon order carries BESIDES its product lines and its sales
 * tax: shipping & handling, and a promotion (a negative line). Both are real
 * money on the card, so both are real bill lines — leaving them off is what made
 * a bill read $43.20 against a $49.19 charge, and $437.56 against $432.36.
 *
 * Sales tax is deliberately NOT here: `createVendorBill` adds it as its own
 * 88 80 00 line (see src/lib/salesTax.ts).
 */
export function orderExtraLines(
  o: Pick<AmazonOrder, "shipping" | "promotion">,
): { name: string; unitCost: number; quantity: number }[] {
  const out: { name: string; unitCost: number; quantity: number }[] = [];
  const ship = round2(o.shipping);
  const promo = round2(o.promotion);
  if (ship !== 0) out.push({ name: "Shipping & handling", unitCost: ship, quantity: 1 });
  // Amazon prints a discount as a negative; accept a positive and negate it, so
  // a promotion never lands on the bill as an extra CHARGE.
  if (promo !== 0) out.push({ name: "Promotion applied", unitCost: -Math.abs(promo), quantity: 1 });
  return out;
}

/**
 * Cents by which the parts fail to add up to the order total, as a signed money
 * string — "" when they reconcile. The bill is built from the parts, so a gap
 * here is exactly the amount the bill would be wrong by.
 */
export function reconcileGap(o: AmazonOrder): string {
  const parts =
    o.lines.reduce((s, l) => s + l.ppu * l.quantity, 0) +
    o.shipping -
    Math.abs(o.promotion) +
    o.tax;
  const gap = round2(parts - o.netTotal);
  return gap === 0 ? "" : `${gap > 0 ? "+" : ""}${gap.toFixed(2)}`;
}

/** Sanitize an Order ID into the bill's idempotency key. Amazon ids are
 *  digits + dashes; keep it defensive in case the export ever changes. */
export function orderExternalId(orderId: string): string {
  return "AMZ-" + orderId.trim().replace(/[^0-9A-Za-z\-]/g, "");
}
