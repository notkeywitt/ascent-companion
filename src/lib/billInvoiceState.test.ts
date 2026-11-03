import { describe, expect, it } from "vitest";

import { billInvoiceState } from "./billInvoiceState";

/**
 * The stripe is the office's triage signal for a month's bills, so the branch
 * order matters more than any single state: a flag must outrank a stage, and a
 * draft must never read as final.
 */
describe("billInvoiceState", () => {
  it("is yellow (needs-review) above every stage", () => {
    expect(
      billInvoiceState({ needsReview: true, status: "approved", onInvoice: true, paid: true }),
    ).toBe("needs-review");
    expect(billInvoiceState({ needsReview: true, status: "draft" })).toBe("needs-review");
  });

  it("says nothing about a draft, even one on a draft invoice", () => {
    expect(billInvoiceState({ status: "draft" })).toBe("none");
    expect(billInvoiceState({ status: "draft", onInvoice: true })).toBe("none");
  });

  it("is light blue for an approved bill no invoice carries yet", () => {
    expect(billInvoiceState({ status: "approved" })).toBe("approved");
    expect(billInvoiceState({ status: "approved", paid: true })).toBe("approved");
    expect(billInvoiceState({ status: "pending" })).toBe("none");
  });

  it("is blue when the bill is on an invoice but not paid", () => {
    expect(billInvoiceState({ status: "approved", onInvoice: true })).toBe("invoiced");
    expect(billInvoiceState({ status: "pending", onInvoice: true })).toBe("invoiced");
  });

  it("is green when the bill is on an invoice and paid", () => {
    expect(billInvoiceState({ status: "approved", onInvoice: true, paid: true })).toBe("paid");
  });
});
