import { describe, expect, it } from "vitest";
import { invoiceActualHtml } from "@/lib/invoicePreview";
import { invoiceToDetail, pickMonthInvoices } from "./clientInvoiceDetail";

describe("pickMonthInvoices", () => {
  const row = (status: string, priceWithTax: number) => ({ status, priceWithTax });
  it("drops voided and $0 warranty invoices", () => {
    expect(pickMonthInvoices([row("denied", 100), row("pending", 0), row("pending", 50)])).toEqual([row("pending", 50)]);
  });
  it("keeps a draft only when nothing was sent", () => {
    expect(pickMonthInvoices([row("draft", 10), row("pending", 20)])).toEqual([row("pending", 20)]);
    expect(pickMonthInvoices([row("draft", 10)])).toEqual([row("draft", 10)]);
  });
});

describe("invoiceToDetail", () => {
  // Main House #54, Oct 2026: JobTread's own totals, not a recompute.
  const inv = {
    id: "i", number: "54", name: "Monthly Invoice", status: "pending", issueDate: "2026-10-31", dueDate: "2026-11-28",
    price: 24022.13, tax: 2005.85, priceWithTax: 26027.98, toName: "Kevin Berger", address: "82 Moonrise Way",
    jobId: "j", jobNumber: "26", jobName: "Main House", accountName: "Kevin Berger",
  };
  const items = [
    { cost: 139.92, code: "05 52 00", codeName: "Metal Railings" },
    { cost: 20217.83, code: "06 15 00", codeName: "Wood Decking" },
  ];
  const mi = invoiceToDetail(inv, items, { "05 00 00": "Metals", "06 00 00": "Wood" });
  it("takes cost from the lines and fee, tax, total from the invoice", () => {
    expect(mi.detail.total).toBe(20357.75);
    expect(mi.actual.fee).toBe(3664.38);
    expect(mi.actual.total).toBe(26027.98);
  });
  it("prints the invoice's figures and number", () => {
    const html = invoiceActualHtml([mi], "2026-10");
    expect(html).toContain("Monthly Invoice 26-54");
    expect(html).toContain("PENDING");
    expect(html).toContain("$26,027.98");
    expect(html).toContain("$2,005.85");
    expect(html).not.toContain("DRAFT PREVIEW");
  });
  it("puts two invoices on two pages of one document", () => {
    const html = invoiceActualHtml([mi, { ...mi, actual: { ...mi.actual, number: "55" } }], "2026-10");
    expect(html.match(/<section class="sheet">/g)).toHaveLength(2);
  });
});
