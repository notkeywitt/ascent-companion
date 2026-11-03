/**
 * The bill/invoice editing policy, as a test. Office and admin may edit a bill
 * or an invoice anywhere (owner, 2026-09-09). Leads may too, through the Jobs
 * Hub's Tracking sheet — its routes only, never the generic gateway (owner,
 * 2026-11-03).
 *
 * Two independent gates have to agree, so both are asserted here:
 *   1. the generic Pave gateway's per-role mutation allowlist, and
 *   2. the middleware view gate over the purpose-built write routes.
 */
import { describe, expect, it } from "vitest";

import { NEVER_ALLOWED, billRefsForMutations, isMutationAllowed } from "@/lib/paveGateway";
import { ROLES, resolveAllowedViews, viewIdForPath } from "@/lib/views";

/** Every Pave mutation that edits a bill, an invoice, or one of their lines. */
// `deleteDocument` is absent on purpose: no role may run it any more (the void
// rule), which the NEVER_ALLOWED test below covers instead.
const DOC_MUTATIONS = [
  "updateDocument",
  "createDocument",
  "createCostItem",
  "updateCostItem",
  "deleteCostItem",
];

/**
 * The write routes a lead reaches through the Jobs Hub's tabs (owner,
 * 2026-11-03): Tracking sheet ("recode"), Job Details ("clients") and
 * Specifications ("specs"). Still off field.
 */
const LEAD_WRITE_ROUTES = [
  "/api/add-bill",
  "/api/add-line",
  "/api/combine-lines",
  "/api/delete-line",
  "/api/code",
  "/api/coding-draft",
  "/api/bill-fields",
  "/api/bill-number",
  "/api/bill-issuedate",
  "/api/bill-duedate",
  "/api/bill-tax",
  "/api/buyback",
  "/api/reassign-job",
  "/api/bill-void",
  "/api/uncaptured",
  "/api/trackingsheet",
  "/api/clients",
  // A live updateCostItem on a budget line (Specifications, 2026-09-29).
  "/api/specs/jobtread",
  // A read, not a write — but it lists every job's draft bills (2026-09-30).
  "/api/coding-queue",
];

/** The write routes that stay office/admin only. */
const OFFICE_WRITE_ROUTES = [
  // Approving a bill can push it to QuickBooks.
  "/api/bill-status",
  "/api/email",
  "/api/lswdd",
  "/api/amazon-import",
  "/api/tracking-sheet",
  "/api/labor-review",
  // Not bill writes, but office/admin writes that were ungated until 2026-09-29.
  "/api/labor-report",
  "/api/time-off/import",
];

const can = (role: string, path: string) =>
  resolveAllowedViews(role).has(viewIdForPath(path) ?? "");

describe("bill + invoice editing: office/admin, plus lead through the Jobs Hub", () => {
  it("allows the document mutations for office and admin, and no one else", () => {
    for (const m of DOC_MUTATIONS) {
      expect(isMutationAllowed("admin", m), `admin ${m}`).toBe(true);
      expect(isMutationAllowed("office", m), `office ${m}`).toBe(true);
      expect(isMutationAllowed("lead", m), `lead ${m}`).toBe(false);
      expect(isMutationAllowed("field", m), `field ${m}`).toBe(false);
    }
  });

  it("keeps every bill/invoice write route gated, and off field", () => {
    for (const path of [...LEAD_WRITE_ROUTES, ...OFFICE_WRITE_ROUTES]) {
      // An unlisted path has no gate at all — middleware would let any signed-in
      // role POST it.
      expect(viewIdForPath(path), `${path} is ungated`).not.toBeNull();
      expect(can("admin", path), `admin ${path}`).toBe(true);
      expect(can("office", path), `office ${path}`).toBe(true);
      expect(can("field", path), `field ${path}`).toBe(false);
    }
  });

  it("opens the Jobs Hub's write routes to lead, and no others", () => {
    for (const path of LEAD_WRITE_ROUTES) expect(can("lead", path), `lead ${path}`).toBe(true);
    for (const path of OFFICE_WRITE_ROUTES) expect(can("lead", path), `lead ${path}`).toBe(false);
  });

  it("leaves the field role's own writes alone", () => {
    for (const m of ["createTimeEntry", "updateTimeEntry", "createDailyLog", "updateTask"]) {
      for (const role of ROLES) expect(isMutationAllowed(role, m), `${role} ${m}`).toBe(true);
    }
  });
});

describe("the QuickBooks lock reaches the generic gateway too", () => {
  it("refuses deleteDocument for EVERY role, admin included", () => {
    expect(NEVER_ALLOWED).toContain("deleteDocument");
    for (const role of ROLES) {
      expect(isMutationAllowed(role, "deleteDocument"), `${role}`).toBe(false);
    }
  });

  it("names the document a mutation would change, so qboLock can check it", () => {
    expect(billRefsForMutations({ updateDocument: { $: { id: "d1" } } })).toEqual([
      { docId: "d1" },
    ]);
    // A cost-item mutation names the LINE; qboLock resolves its bill.
    expect(billRefsForMutations({ updateCostItem: { $: { id: "c1" } } })).toEqual([
      { costItemId: "c1" },
    ]);
    expect(billRefsForMutations({ createCostItem: { $: { documentId: "d2" } } })).toEqual([
      { docId: "d2" },
    ]);
    // A `_` alias must not slip a document mutation past the extraction.
    expect(billRefsForMutations({ innocent: { _: "updateDocument", $: { id: "d3" } } })).toEqual([
      { docId: "d3" },
    ]);
  });

  it("finds nothing to lock on a read, or on a budget leaf", () => {
    expect(billRefsForMutations({ document: { $: { id: "d1" }, cost: {} } })).toEqual([]);
    // createCostItem with a jobId and no documentId is a BUDGET line, not a bill line.
    expect(billRefsForMutations({ createCostItem: { $: { jobId: "j1" } } })).toEqual([]);
  });
});
