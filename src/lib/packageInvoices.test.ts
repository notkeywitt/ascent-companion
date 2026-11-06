import { describe, expect, it } from "vitest";

import { jobInvoices } from "./packageInvoices";

describe("jobInvoices", () => {
  it("reads the list, primary first", () => {
    const list = jobInvoices({
      jtJobId: "j",
      invoices: [
        { id: "d134", number: "134", status: "pending", balance: 10, priceWithTax: 1700, warranty: false },
        { id: "d130", number: 130, status: "draft", balance: 0, priceWithTax: 0, warranty: true },
      ],
    });
    expect(list.map((i) => [i.number, i.warranty])).toEqual([["134", false], ["130", true]]);
  });

  it("falls back to the single invoice of an older payload", () => {
    expect(
      jobInvoices({
        jtJobId: "j",
        invoiceNumber: "379",
        invoiceStatus: "approved",
        invoiceBalance: 5,
        links: { jtInvoice: "https://app.jobtread.com/jobs/j/documents/22PgEjYqdEsq" },
      }),
    ).toEqual([{ id: "22PgEjYqdEsq", number: "379", status: "approved", balance: 5, priceWithTax: 0, warranty: false }]);
  });

  it("is empty for a job with no invoice", () => {
    expect(jobInvoices({ jtJobId: "j", invoiceNumber: "" })).toEqual([]);
    expect(jobInvoices({ jtJobId: "j", invoices: [] })).toEqual([]);
  });
});
