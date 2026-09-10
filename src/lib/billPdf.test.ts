import { describe, expect, it } from "vitest";
import { buildBillPdf } from "./billPdf";

/** The one thing that breaks silently: a PDF whose xref offsets don't point at
 *  their objects still "renders" as a blank or refuses to open at all. So parse
 *  the table back and check every offset lands on `<n> 0 obj`. */
function xrefOffsetsAreSound(pdf: Buffer): boolean {
  const s = pdf.toString("latin1");
  const start = Number(s.slice(s.lastIndexOf("startxref")).split("\n")[1]);
  const table = s.slice(start).split("\n");
  const count = Number(table[1].split(" ")[1]);
  for (let i = 1; i < count; i++) {
    const off = Number(table[2 + i].slice(0, 10));
    if (!s.startsWith(`${i} 0 obj`, off)) return false;
  }
  return true;
}

const bill = {
  vendor: "Kelly-Moore Paint",
  billNumber: "4471",
  job: "Perkins Residence",
  customer: "Otis Perkins",
  issueDate: "2026-08-31",
  dueDate: "2026-09-30",
  description: "Counter charge picked up at the yard. No invoice given.",
  lines: [
    { name: "Interior primer, 5 gal", code: "09 90 00 Painting", quantity: 2, amount: 218.4 },
    { name: "Sales Tax", code: "88 80 00", quantity: 1, amount: 18.02 },
  ],
  total: 236.42,
};

describe("buildBillPdf", () => {
  it("writes a readable one-page PDF with the bill's facts on it", () => {
    const pdf = buildBillPdf(bill);
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(xrefOffsetsAreSound(pdf)).toBe(true);
    expect(s).toContain("ASCENT");
    expect(s).toContain("Kelly-Moore Paint");
    expect(s).toContain("Perkins Residence");
    expect(s).toContain("$236.42");
    expect(s).toContain("Counter charge picked up");
    expect(s).toContain("/Count 1");
  });

  it("breaks onto more pages when the lines don't fit, and keeps the xref sound", () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      name: `Line ${i + 1} — a description long enough to need clipping in its column`,
      code: "06 10 00 Rough Carpentry",
      quantity: 1,
      amount: 10,
    }));
    const pdf = buildBillPdf({ ...bill, lines, total: 1200 });
    const s = pdf.toString("latin1");
    expect(xrefOffsetsAreSound(pdf)).toBe(true);
    expect(s).toMatch(/\/Count [2-9]/);
    expect(s).toContain("Page 1 of ");
  });

  it("keeps non-Latin-1 text out of the stream", () => {
    const s = buildBillPdf({ ...bill, vendor: "Café “Ünïcode” — 日本", description: "naïve ✓" })
      .toString("latin1");
    expect(s).toContain("Cafe \"Unicode\" -");
    expect(s).not.toMatch(/[^\x00-\xFF]/);
  });
});
