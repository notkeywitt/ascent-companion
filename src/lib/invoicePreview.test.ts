import { describe, expect, it } from "vitest";
import { invoicePreviewHtml } from "./invoicePreview";
import type { Detail } from "@/components/BillingSummary";

const detail: Detail = {
  customer: { id: "c", name: "Ferron" },
  job: { id: "j", name: "Otis Perkins Addition" },
  total: 100,
  lines: [
    {
      key: "b1", label: "Bill", cost: 100, billIds: ["b1"], isSunset: false,
      bills: [{ id: "b1", label: "Bill", cost: 100, invoiced: false, csi: [{ code: "06 20 23", name: "Interior Finish Carpentry", amount: 100 }] }],
    },
  ],
  invoice: { jobNumber: "004", address: "1 Main", accountName: "Ferron", contactName: "Bill", email: "b@x.com", markup: 1.18, fee: 18, divisions: { "06 00 00": "Wood, Plastics, and Composites" } },
};

describe("invoicePreviewHtml", () => {
  const html = invoicePreviewHtml(detail, "2026-09");
  it("rolls codes into divisions and adds fee and tax", () => {
    expect(html).toContain("06 00 00 Wood, Plastics, and Composites");
    expect(html).toContain("Total fee (18%)");
    expect(html).toContain("$127.85"); // (100 + 18) * 1.0835
  });
  it("prints itself only when asked, and uses no flexbox", () => {
    expect(html).not.toContain("window.print");
    expect(invoicePreviewHtml(detail, "2026-09", { autoPrint: true })).toContain("window.print");
    expect(html).not.toContain("display: flex");
  });
});
