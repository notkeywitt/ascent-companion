import { describe, expect, it } from "vitest";

import { canAttach, onlyTaskChanged, type DocForLink } from "./taskDocuments";

const doc: DocForLink = {
  id: "d",
  orgId: "o",
  type: "vendorBill",
  status: "approved",
  jobId: "j",
  taskId: "",
  externalId: "gmail-1",
  cost: 90.94,
  price: 0,
};

describe("onlyTaskChanged", () => {
  it("accepts a change of the task alone", () => {
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t" })).toBe(true);
  });
  it("refuses when status, externalId, cost, price, type or job moved", () => {
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", status: "draft" })).toBe(false);
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", externalId: "" })).toBe(false);
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", cost: 91 })).toBe(false);
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", price: 5 })).toBe(false);
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", type: "customerOrder" })).toBe(false);
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", jobId: "other" })).toBe(false);
  });
  it("ignores rounding below half a cent", () => {
    expect(onlyTaskChanged(doc, { ...doc, taskId: "t", cost: 90.944 })).toBe(true);
  });
});

describe("canAttach", () => {
  it("takes only a draft bill or expense, and any other type", () => {
    expect(canAttach("vendorBill", "draft")).toBe(true);
    expect(canAttach("vendorBill", "approved")).toBe(false);
    expect(canAttach("vendorBill", "pending")).toBe(false);
    expect(canAttach("customerOrder", "approved")).toBe(true);
    expect(canAttach("vendorOrder", "pending")).toBe(true);
  });
});
