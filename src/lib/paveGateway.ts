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
 *  - LEAD:  field + CODE existing documents (updateDocument + cost-item lines).
 *           Leads may NOT create or delete whole bills/invoices.
 *  - OFFICE: lead + create documents, apply/manage payments, files, comments,
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

const LEAD_WRITES: string[] = [
  ...FIELD_WRITES,
  // CODE existing bills/invoices: header/status/tax/date edits + line coding.
  // (No createDocument / deleteDocument — leads can't create or delete whole docs.)
  "updateDocument",
  "createCostItem",
  "updateCostItem",
  "deleteCostItem",
];

const OFFICE_WRITES: string[] = [
  ...LEAD_WRITES,
  // Create bills/invoices, and delete whole documents & payments.
  "createDocument",
  "deleteDocument",
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

export const ROLE_WRITE_ALLOWLIST: Record<Role, "all" | string[]> = {
  admin: "all",
  office: OFFICE_WRITES,
  lead: LEAD_WRITES,
  field: FIELD_WRITES,
};

/** True if `role` may run `mutation` through the gateway (allowlist check only). */
export function isMutationAllowed(role: Role, mutation: string): boolean {
  const set = ROLE_WRITE_ALLOWLIST[role];
  return set === "all" ? true : set.includes(mutation);
}
