import { describe, expect, it } from "vitest";

import type { TaskDocument } from "@/lib/jobtread/taskDocuments";
import { docMatches, docTotals } from "./taskDocs";

const doc = (over: Partial<TaskDocument>): TaskDocument => ({
  id: "d",
  type: "vendorBill",
  status: "approved",
  name: "Bill",
  number: 6,
  amount: 100,
  issueDate: "2026-11-01",
  accountName: "Sunset Builders Supply",
  jobId: "j",
  taskId: "t",
  ...over,
});

describe("docTotals", () => {
  it("sums bills and estimates apart, and counts every document", () => {
    const t = docTotals([
      doc({ amount: 15.2 }),
      doc({ amount: 90.94 }),
      doc({ type: "customerOrder", amount: 5000 }),
      doc({ type: "vendorOrder", amount: 700 }),
    ]);
    expect(t).toEqual({ bills: 106.14, estimates: 5000, count: 4 });
  });
  it("is zero for no documents", () => {
    expect(docTotals([])).toEqual({ bills: 0, estimates: 0, count: 0 });
  });
});

describe("docMatches", () => {
  it("matches vendor, number, type and name, ignoring case", () => {
    expect(docMatches(doc({}), "sunset")).toBe(true);
    expect(docMatches(doc({}), "6")).toBe(true);
    expect(docMatches(doc({ type: "customerOrder" }), "ESTIMATE")).toBe(true);
    expect(docMatches(doc({}), "lumber")).toBe(false);
  });
  it("matches everything for an empty search", () => {
    expect(docMatches(doc({}), "  ")).toBe(true);
  });
});
