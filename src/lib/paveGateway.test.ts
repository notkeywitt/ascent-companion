import { describe, expect, it } from "vitest";
import { findMutations, isMutationAllowed, sanitizeQuery, MUTATION_RE } from "./paveGateway";

/**
 * The /api/pave write gate.
 *
 * This is the only thing standing between a browser-composed query and an
 * arbitrary JobTread mutation, and `findMutations` is now ALSO what decides
 * whether pave() may retry a request. A hole here is a wrong write to the live
 * org, so the cases below are about the ways it could wrongly say "this is a
 * read".
 */

describe("findMutations", () => {
  it("returns nothing for an ordinary read", () => {
    expect(findMutations({ job: { $: { id: "j1" }, id: {}, name: {} } })).toEqual([]);
  });

  it("flags a mutation at the query root", () => {
    expect(findMutations({ updateCostItem: { $: { id: "c1" } } })).toEqual(["updateCostItem"]);
  });

  it("flags every mutation when several share one query", () => {
    const found = findMutations({ createDocument: {}, deleteCostItem: {}, job: {} });
    expect(found.sort()).toEqual(["createDocument", "deleteCostItem"]);
  });

  it("flags a mutation hidden behind a `_` type alias", () => {
    // The alias is how a caller renames a root field; the real operation is `_`.
    expect(findMutations({ harmlessLookingName: { _: "deleteDocument" } })).toEqual([
      "deleteDocument",
    ]);
  });

  it("ignores the root args object", () => {
    expect(findMutations({ $: { grantKey: "x" }, job: {} })).toEqual([]);
  });

  // The regression that matters most for retry: a READ that merely SELECTS
  // fields whose names start with a mutation verb must not look like a write, or
  // pave() would refuse to retry ordinary reads.
  it("does not flag createdAt / updatedAt selected as nested fields", () => {
    const q = {
      document: {
        $: { id: "d1" },
        id: {},
        createdAt: {},
        updatedAt: {},
        costItems: { nodes: { id: {}, updatedAt: {} } },
      },
    };
    expect(findMutations(q)).toEqual([]);
  });

  it("does not flag nested input args that merely start with a verb", () => {
    // e.g. copyFromFile / copyTasksFromJobId are arguments, not root mutations.
    const q = { createJob: { $: { copyFromFile: "f1", copyTasksFromJobId: "j9" } } };
    expect(findMutations(q)).toEqual(["createJob"]); // the root only, once
  });

  it("covers every verb the regex claims to cover", () => {
    const verbs = [
      "create", "update", "delete", "send", "submit", "rerun",
      "cancel", "close", "notify", "copy", "mark", "rename", "sign", "draft", "deprecate",
    ];
    for (const v of verbs) {
      expect(MUTATION_RE.test(`${v}Something`), `${v} should be a mutation`).toBe(true);
    }
  });

  it("treats noun-rooted reads as reads", () => {
    for (const noun of ["job", "organization", "document", "costItem", "currentGrant", "account"]) {
      expect(MUTATION_RE.test(noun), `${noun} should NOT be a mutation`).toBe(false);
    }
  });
});

describe("sanitizeQuery", () => {
  it("strips a caller-supplied root $ so grantKey/viaUserId can't be forced", () => {
    const out = sanitizeQuery({ $: { grantKey: "stolen", viaUserId: "someone" }, job: { id: {} } });
    expect(out).not.toHaveProperty("$");
    expect(out).toHaveProperty("job");
  });

  it("preserves a PER-FIELD $, which is a legitimate arg object", () => {
    const out = sanitizeQuery({ job: { $: { id: "j1" }, id: {} } }) as Record<string, any>;
    expect(out.job.$).toEqual({ id: "j1" });
  });
});

describe("isMutationAllowed", () => {
  it("lets admin through", () => {
    expect(isMutationAllowed("admin", "deleteDocument")).toBe(true);
  });

  it("refuses a role an unlisted mutation", () => {
    // field is the least-privileged role; it should not be deleting documents.
    expect(isMutationAllowed("field", "deleteDocument")).toBe(false);
  });

  it("does not let a lead create or delete whole documents", () => {
    // Documented policy: leads may CODE existing documents, not create/delete them.
    expect(isMutationAllowed("lead", "updateDocument")).toBe(true);
    expect(isMutationAllowed("lead", "createDocument")).toBe(false);
    expect(isMutationAllowed("lead", "deleteDocument")).toBe(false);
  });

  it("refuses an unknown mutation name for every non-admin role", () => {
    for (const role of ["office", "lead", "field"] as const) {
      expect(isMutationAllowed(role, "destroyEverything")).toBe(false);
    }
  });
});
