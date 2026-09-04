import { describe, expect, it } from "vitest";

import { billInvoiceState } from "./billInvoiceState";

/**
 * The stripe is the office's triage signal for a month's bills, so the branch
 * order matters more than any single state: a flag must outrank a stage, and
 * "left off the invoice" must not fire in a month that has no invoice yet.
 */
describe("billInvoiceState", () => {
  it("puts needs-review above every stage", () => {
    expect(
      billInvoiceState({ needsReview: true, status: "approved", onInvoice: true }),
    ).toBe("needs-review");
    expect(billInvoiceState({ needsReview: true, status: "draft", reviewed: true })).toBe(
      "needs-review",
    );
  });

  it("marks a draft blue only once it has been reviewed", () => {
    expect(billInvoiceState({ status: "draft", reviewed: true })).toBe("reviewed");
    expect(billInvoiceState({ status: "draft" })).toBe("none");
  });

  it("never calls a draft invoiced or missing, whatever the month looks like", () => {
    expect(billInvoiceState({ status: "draft", onInvoice: true })).toBe("none");
    expect(billInvoiceState({ status: "draft", monthInvoiceExists: true })).toBe("none");
  });

  it("is green when a finalized bill sits on an invoice", () => {
    expect(billInvoiceState({ status: "pending", onInvoice: true })).toBe("invoiced");
    expect(
      billInvoiceState({ status: "approved", onInvoice: true, monthInvoiceExists: true }),
    ).toBe("invoiced");
  });

  it("flags a finalized bill left off the month's invoice, and only then", () => {
    expect(billInvoiceState({ status: "pending", monthInvoiceExists: true })).toBe("missing");
    expect(billInvoiceState({ status: "pending" })).toBe("none");
  });
});
