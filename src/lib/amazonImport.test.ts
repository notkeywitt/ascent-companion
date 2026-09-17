import { describe, expect, it } from "vitest";
import { orderExtraLines, parseAmazonCsv, reconcileGap } from "./amazonImport";

/**
 * The bug these cover: the import built a bill from product lines + sales tax
 * only, so shipping and promotions vanished. Two real orders went in wrong —
 * 113-4669217 billed $43.20 against a $49.19 charge (lost $5.99 shipping), and
 * 113-9594981 billed $437.56 against a $432.36 charge (kept a -$5.20 promotion
 * it should have subtracted). A bill that does not equal the card charge is
 * exactly what the bookkeeper cannot reconcile, so the sum is the test.
 */

const HEADER = [
  "Order Date",
  "Order ID",
  "PO Number",
  "Order Subtotal",
  "Order Shipping & Handling",
  "Order Promotion",
  "Order Tax",
  "Order Net Total",
  "Payment Identifier",
  "Title",
  "Item Quantity",
  "Purchase PPU",
  "Item Subtotal",
  "Item Tax",
  "Item Net Total",
].join(",");

const row = (cells: (string | number)[]) => cells.map((c) => `"${c}"`).join(",");

/** What the route/createVendorBill would charge for: product lines + extras. */
const billTotal = (o: Parameters<typeof reconcileGap>[0]) =>
  Math.round(
    (o.lines.reduce((s, l) => s + l.ppu * l.quantity, 0) +
      orderExtraLines(o).reduce((s, l) => s + l.unitCost * l.quantity, 0) +
      o.tax) *
      100,
  ) / 100;

describe("parseAmazonCsv", () => {
  it("bills shipping as its own line, so the total matches the card charge", () => {
    const csv = [
      HEADER,
      row([
        "07/22/2026", "113-4669217-1986641", "SEELY",
        43.2, 5.99, 0, 0, 49.19, "=\"1468\"",
        "Baldwin 4000.112 Floor Type Half Dome Door Bumper", 2, 21.6, 43.2, 0, 43.2,
      ]),
    ].join("\n");

    const { orders } = parseAmazonCsv(csv);
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(o.shipping).toBe(5.99);
    expect(orderExtraLines(o)).toEqual([
      { name: "Shipping & handling", unitCost: 5.99, quantity: 1 },
    ]);
    expect(billTotal(o)).toBe(49.19);
    expect(reconcileGap(o)).toBe("");
  });

  it("subtracts a promotion instead of dropping it", () => {
    const csv = [
      HEADER,
      row([
        "07/19/2026", "113-9594981-6230623", "Shop",
        404.24, 0, -5.2, 33.32, 432.36, "=\"1468\"",
        "Mirka Abranet 6 Inch Sanding Discs 220 Grit", 4, 55.08, 220.32, 0, 220.32,
      ]),
      row([
        "07/19/2026", "113-9594981-6230623", "Shop",
        404.24, 0, -5.2, 33.32, 432.36, "=\"1468\"",
        "Mirka Abranet 6 Inch Grip Sanding Discs 120 Grit", 3, 45, 135, 0, 135,
      ]),
      row([
        "07/19/2026", "113-9594981-6230623", "Shop",
        404.24, 0, -5.2, 33.32, 432.36, "=\"1468\"",
        "Mirka Abranet 6 Inch Grip Sanding Discs 80 Grit", 1, 48.92, 48.92, 0, 48.92,
      ]),
    ].join("\n");

    const { orders } = parseAmazonCsv(csv);
    const o = orders[0];
    expect(o.promotion).toBe(-5.2);
    expect(orderExtraLines(o)).toEqual([
      { name: "Promotion applied", unitCost: -5.2, quantity: 1 },
    ]);
    expect(billTotal(o)).toBe(432.36);
    expect(reconcileGap(o)).toBe("");
  });

  it("a promotion printed positive is still subtracted", () => {
    expect(orderExtraLines({ shipping: 0, promotion: 5.2 })).toEqual([
      { name: "Promotion applied", unitCost: -5.2, quantity: 1 },
    ]);
  });

  it("reports the gap when the printed parts do not add up", () => {
    const csv = [
      HEADER,
      row([
        "08/04/2026", "113-3765828-7819460", "SHOP",
        15.25, 0, 0, 0, 20.25, "=\"1468\"",
        "Splinter Guard Replacement Strip", 1, 15.25, 15.25, 0, 15.25,
      ]),
    ].join("\n");

    const { orders, warnings } = parseAmazonCsv(csv);
    expect(reconcileGap(orders[0])).toBe("-5.00");
    expect(warnings.join(" ")).toContain("113-3765828-7819460");
  });
});
