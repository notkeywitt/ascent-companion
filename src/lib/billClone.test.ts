import { describe, expect, it } from "vitest";

import {
  canReclone,
  checkAgainstStatements,
  cloneExternalId,
  hasLiveClone,
  monthRange,
  planClones,
  type CloneDoc,
} from "./billClone";

const doc = (o: Partial<CloneDoc>): CloneDoc => ({
  id: "d1",
  jobId: "j1",
  jobName: "Shop",
  number: "1",
  externalId: "714268",
  issueDate: "2026-10-01",
  cost: 9.99,
  name: "Expense",
  status: "approved",
  qboDocumentType: "purchase",
  qboId: "purchase:1",
  ...o,
});

describe("bill clones", () => {
  it("names a clone with -B, inside 32", () => {
    expect(cloneExternalId({ id: "x", externalId: "714268" })).toBe("714268-B");
    expect(cloneExternalId({ id: "x", externalId: "" })).toBe("x-B");
    expect(cloneExternalId({ id: "x", externalId: "A".repeat(40) })).toHaveLength(32);
  });

  it("pairs each Expense with its clone and walks the stages", () => {
    const orig = doc({});
    const clone = doc({ id: "c1", externalId: "714268-B", status: "draft", qboId: "" });
    expect(planClones([orig]).pairs[0].stage).toBe("no clone");
    expect(planClones([orig, clone]).pairs[0].stage).toBe("cloned");
    const bill = { ...clone, name: "Bill", qboDocumentType: "bill" };
    expect(planClones([orig, bill]).pairs[0].stage).toBe("bill");
    const sent = { ...bill, status: "pending", qboId: "77" };
    expect(planClones([orig, sent]).pairs[0].stage).toBe("approved");
    const plan = planClones([{ ...orig, status: "denied" }, sent]);
    expect(plan.pairs[0].stage).toBe("done");
    expect(plan.extraClones).toHaveLength(0);
  });

  it("leaves credits, voids and statement bills alone, and flags extras", () => {
    const plan = planClones([
      doc({ id: "cr", cost: -10, name: "Credit", qboDocumentType: "vendorCredit" }),
      doc({ id: "v", status: "denied" }),
      doc({ id: "s", externalId: "STMT-1", name: "Bill", qboDocumentType: "bill" }),
      doc({ id: "e", externalId: "999-B", name: "Bill", qboDocumentType: "bill" }),
    ]);
    expect(plan.pairs).toHaveLength(0);
    expect(plan.skipped.map((d) => d.id)).toEqual(["cr", "s"]);
    expect(plan.extraClones.map((d) => d.id)).toEqual(["e"]);
  });

  it("pairs a clone with the live re-made bill, not the void on the old job", () => {
    const voided = doc({ id: "old", jobId: "bunk", status: "denied" });
    const live = doc({ id: "new", jobId: "main" });
    const clone = doc({ id: "c1", jobId: "main", externalId: "714268-B", status: "draft", qboId: "" });
    const plan = planClones([voided, live, clone]);
    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0].original.id).toBe("new");
    expect(plan.pairs[0].clone?.id).toBe("c1");
    expect(plan.pairs[0].differences).toEqual([]);
    expect(hasLiveClone([voided, live, clone], live)).toBe(true);
  });

  it("offers a move for a draft copy on the wrong job", () => {
    const plan = planClones([
      doc({ jobId: "main" }),
      doc({ id: "c1", jobId: "bunk", externalId: "714268-B", status: "draft", qboId: "" }),
    ]);
    expect(plan.pairs[0].differences).toEqual(["job"]);
    expect(canReclone(plan.pairs[0])).toBe(true);
  });

  it("flags a clone whose amount differs", () => {
    const plan = planClones([doc({}), doc({ id: "c1", externalId: "714268-B", cost: 10 })]);
    expect(plan.pairs[0].differences).toEqual(["amount 9.99 vs 10"]);
  });

  it("checks clones against statement lines", () => {
    const plan = planClones([doc({}), doc({ id: "c1", externalId: "714268-B", status: "draft" })]);
    const r = checkAgainstStatements(plan.pairs, [
      { number: "714268", amount: 9.99, statement: "S" },
      { number: "800000", amount: 5, statement: "S" },
    ]);
    expect(r.byCloneId.c1.verdict).toBe("match");
    expect(r.unmatched.map((l) => l.number)).toEqual(["800000"]);
  });

  it("reads a month", () => {
    expect(monthRange("2026-10")).toEqual({ first: "2026-10-01", last: "2026-10-31" });
    expect(monthRange("bad")).toBeNull();
  });
});
