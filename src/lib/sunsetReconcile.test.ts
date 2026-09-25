import { describe, expect, it } from "vitest";
import { reconcileState } from "./sunsetReconcile";
import { previousMonth } from "./homeFacts";

const rc = { invoiceCount: 2, creditCount: 0, netTotal: 100 };

describe("reconcileState — the /payments green test the home card counts", () => {
  it("is green when the net matches and nothing is off by invoice number", () => {
    expect(reconcileState({ extractedAt: "x", net: "100.00", total: "103" }, rc).reconciled).toBe(true);
  });
  it("is not green before the discount is read (no net, no captured lines)", () => {
    expect(reconcileState({ extractedAt: "", net: "", total: "100" }, rc).reconciled).toBe(false);
  });
  it("is not green when totals match but an invoice is missing", () => {
    const withMiss = { ...rc, match: { missing: [{}], mismatched: [], extra: [] } };
    expect(reconcileState({ extractedAt: "x", net: "100", total: "100" }, withMiss).reconciled).toBe(false);
  });
  it("adds bought-back amounts back before comparing", () => {
    const bb = { ...rc, netTotal: 90, boughtBackTotal: 10 };
    expect(reconcileState({ extractedAt: "x", net: "100", total: "100" }, bb).reconciled).toBe(true);
  });
});

describe("previousMonth — what the Amazon/LSWDD reminders compare against", () => {
  it("rolls January back to December of the year before", () => {
    expect(previousMonth(new Date("2026-01-15T20:00:00Z"))).toBe("2025-12");
  });
  it("reads the company timezone: Oct 1 at 5am UTC is still Sept 30 in Pacific", () => {
    expect(previousMonth(new Date("2026-10-01T05:00:00Z"))).toBe("2026-08");
  });
});
