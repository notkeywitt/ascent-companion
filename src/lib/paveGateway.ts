/**
 * Policy + query inspection for the generic Pave gateway (/api/pave).
 *
 * PURE module — no Node/DB/React/auth imports — so it stays trivially testable
 * and safe to import anywhere. The route handler (src/app/api/pave/route.ts)
 * composes these with auth() + config + pave().
 *
 * Model (matches the Pave execution model): mutations run ONLY at the query
 * ROOT. So we detect writes by inspecting the TOP-LEVEL keys of the query (plus
 * their `_` type-alias). Nested keys are sub-field selections / arg objects —
 * scanning them would false-positive on input args like `copyFromFile` /
 * `copyTasksFromJobId`, which are NOT mutations. See JT_API_REFERENCE.md.
 */

import type { Role } from "@/lib/views";

/**
 * A root field is a WRITE if its name starts with one of these verbs. Every read
 * root field in the schema is a noun (job, document, costItem, currentGrant, …)
 * or a safe verb we treat as read (whoCan/can/pdf/schema), so these prefixes
 * cleanly separate writes from reads. Confirmed against the root introspection
 * on 2026-07-30 (no read field starts with any of these).
 */
export const MUTATION_RE =
  /^(create|update|delete|send|submit|rerun|cancel|close|notify|copy|mark|rename|sign|draft|deprecate)/;

/**
 * Root-field names in `query` that are mutations. Inspects only the top level
 * (Pave runs mutations only at the root) plus each entry's `_` alias, so it
 * never mis-flags a nested input arg. `$` (root args) is skipped.
 */
export function findMutations(query: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const [key, val] of Object.entries(query)) {
    if (key === "$") continue;
    if (MUTATION_RE.test(key)) found.add(key);
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const alias = (val as Record<string, unknown>)["_"];
      if (typeof alias === "string" && MUTATION_RE.test(alias)) found.add(alias);
    }
  }
  return [...found];
}

/**
 * Strip the caller-supplied root `$`. The gateway owns root args — it injects
 * the grantKey server-side (via pave()) — so a client must not be able to set
 * `$.grantKey` (would override our injected key) or `$.viaUserId` (would let
 * them act as another user). Per-field `$` (e.g. `{ job: { $: { id } } }`) is
 * nested, not root, and is preserved.
 */
export function sanitizeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const { $: _drop, ...rest } = query;
  return rest;
}

/**
 * Per-role write allowlist for the gateway. `"all"` = any mutation; an array =
 * exactly those mutation names. A role may only run a mutation through the
 * gateway if it is listed here (AND both write gates are on — see config).
 *
 * Policy confirmed with the owner 2026-07-30:
 *  - FIELD: time entries + daily logs + schedule tasks/to-dos.
 *  - LEAD:  field only. Revised 2026-09-09: a lead may no longer CODE a
 *           document (updateDocument + the cost-item trio moved to office).
 *  - OFFICE: lead + CODE existing documents (updateDocument + cost-item lines),
 *           create documents, apply/manage payments, files, comments,
 *           memberships (pay rates), contacts/locations/accounts (create+edit),
 *           AND delete whole bills/invoices & payments.
 *  - ADMIN: everything.
 * Structural/config mutations (jobs, roles, workflows, webhooks, cost-code /
 * cost-type / unit catalogs, document templates, custom-field definitions,
 * dashboards, data views, forms) are ADMIN-ONLY — they're simply absent from the
 * arrays below and reachable only via admin's `"all"`. Nouns are Pave root
 * mutation names (see JT_API_REFERENCE.md).
 */
const FIELD_WRITES: string[] = [
  // Clock time (mirrors the /employee-time view).
  "createTimeEntry",
  "updateTimeEntry",
  "deleteTimeEntry",
  // Daily logs from the field.
  "createDailyLog",
  "updateDailyLog",
  "deleteDailyLog",
  // Schedule tasks + to-dos.
  "createTask",
  "updateTask",
  "deleteTask",
];

// Leads add NOTHING to the gateway allowlist. Bill/invoice editing is
// office+admin only (owner, 2026-09-09): a lead used to hold updateDocument +
// the cost-item trio, which is exactly "recode a bill", and updateCostItem also
// edits a job's BUDGET leaves (a cost item with document == null). Both are
// office work, so the four moved to OFFICE_WRITES below. Leads keep their
// FIELD_WRITES (time, daily logs, tasks) through this alias.
const LEAD_WRITES: string[] = [...FIELD_WRITES];

const OFFICE_WRITES: string[] = [
  ...LEAD_WRITES,
  // CODE existing bills/invoices: header/status/tax/date edits + line coding,
  // and the budget leaves those lines are coded against.
  "updateDocument",
  "createCostItem",
  "updateCostItem",
  "deleteCostItem",
  // Create bills/invoices, and manage payments. NOT deleteDocument — see
  // NEVER_ALLOWED above: a bill that must stop counting is voided, not deleted.
  "createDocument",
  "createPayment",
  "updatePayment",
  "deletePayment",
  "createDocumentPayment",
  "updateDocumentPayment",
  "deleteDocumentPayment",
  "sendDocument",
  "createDocumentRecipient",
  "updateDocumentRecipient",
  "deleteDocumentRecipient",
  // Pay rates (labor-rates view uses updateMembership).
  "updateMembership",
  // Files / uploads / tags.
  "createUploadRequest",
  "createFile",
  "updateFile",
  "deleteFile",
  "createFileTag",
  "updateFileTag",
  "deleteFileTag",
  // Comments.
  "createComment",
  "updateComment",
  "deleteComment",
  // Contacts / locations / accounts (create + edit; deletes stay admin-only).
  "createContact",
  "updateContact",
  "createLocation",
  "updateLocation",
  "createAccount",
  "updateAccount",
];

/**
 * Mutations NO role may run through this gateway — admin included, which is why
 * they are a separate check from the per-role allowlist below.
 *
 * `deleteDocument` destroys a bill's history. The rule (see CLAUDE.md, and
 * `_jtVoidDocument` in the ascent-appscript repo) is that a bill which must stop
 * counting is VOIDED — payments removed, status `denied` — never deleted, because
 * the void keeps the externalId that stops the hourly mirror re-creating the bill
 * as an unmatched row. That rule used to live only in prose while the mutation
 * sat on the office allowlist. Now the gateway refuses it.
 */
export const NEVER_ALLOWED: string[] = ["deleteDocument"];

/**
 * The bill/invoice a document-or-line mutation would change, so the caller can
 * apply the QuickBooks lock (src/lib/qboLock.ts) to the generic gateway too.
 * Reads only the query ROOT, same model as `findMutations`.
 *
 * `$.id` means different things per mutation: on a document mutation it is the
 * document, on a cost-item one it is the LINE — and a line still names its bill,
 * which is why qboLock takes either.
 */
export function billRefsForMutations(
  query: Record<string, unknown>,
): { docId?: string; costItemId?: string }[] {
  const refs: { docId?: string; costItemId?: string }[] = [];
  for (const [key, val] of Object.entries(query)) {
    if (key === "$" || !val || typeof val !== "object" || Array.isArray(val)) continue;
    const node = val as Record<string, unknown>;
    const alias = typeof node["_"] === "string" ? (node["_"] as string) : "";
    const name = alias || key;
    const args = (node["$"] ?? {}) as Record<string, unknown>;
    const id = typeof args.id === "string" ? args.id : "";
    const documentId = typeof args.documentId === "string" ? args.documentId : "";
    if (name === "updateDocument" || name === "deleteDocument") {
      if (id) refs.push({ docId: id });
    } else if (name === "updateCostItem" || name === "deleteCostItem") {
      if (id) refs.push({ costItemId: id });
    } else if (name === "createCostItem") {
      // A budget leaf (jobId, no documentId) is not on a bill, so nothing to lock.
      if (documentId) refs.push({ docId: documentId });
    }
  }
  return refs;
}

export const ROLE_WRITE_ALLOWLIST: Record<Role, "all" | string[]> = {
  admin: "all",
  office: OFFICE_WRITES,
  lead: LEAD_WRITES,
  field: FIELD_WRITES,
};

/** True if `role` may run `mutation` through the gateway (allowlist check only). */
export function isMutationAllowed(role: Role, mutation: string): boolean {
  if (NEVER_ALLOWED.includes(mutation)) return false;
  const set = ROLE_WRITE_ALLOWLIST[role];
  return set === "all" ? true : set.includes(mutation);
}
