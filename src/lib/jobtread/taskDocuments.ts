// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, pave, type PaveConfig } from "./core";

// ---------------------------------------------------------------------------
// DOCUMENTS ON SCHEDULE TASKS — JobTread's own link (`document.task`)
// ---------------------------------------------------------------------------
//
// A bill, an estimate, a vendor order or a bid request can carry one schedule
// task (`taskId` on createDocument / updateDocument; `task.documents` reads it
// back). The Schedule page shows the link and sets it. Nothing else in the app reads or writes `document.task`.
//
// Reads page the org's documents with a task, with NO nested connection
// (PAVE_GOTCHAS: two-phase rule). A voided bill (`denied`) is left out: it
// stops counting everywhere.

/** The document types that can sit on a task. An invoice is not one of them. */
export const TASK_DOC_TYPES = ["vendorBill", "customerOrder", "vendorOrder", "bidRequest"] as const;
export type TaskDocType = (typeof TASK_DOC_TYPES)[number];

/**
 * JobTread lets only a DRAFT document sit on a task: a bill or expense (both
 * are `vendorBill`), an estimate (`customerOrder`) or a bid request (owner,
 * 2026-11-19). Applied to a vendor order too, the one type the owner did not
 * name: a draft-only list hides, it never harms. `type` stays a parameter so a
 * type with its own rule can be told apart later.
 */
export const canAttach = (_type: string, status: string) => status === "draft";

export interface TaskDocument {
  id: string;
  type: TaskDocType;
  status: string;
  name: string;
  number: number | null;
  /** Dollars: a customer document's price with tax; a vendor document's cost plus tax. */
  amount: number;
  issueDate: string | null;
  /** The vendor (vendor documents) or customer (customer documents) account. */
  accountName: string;
  jobId: string;
  /** The task it sits on, or "" when none. */
  taskId: string;
  /** The cost codes on its lines, "07 46 23 Wood Siding", each once. */
  costCodes: string[];
}

const DOC_FIELDS = {
  id: {},
  type: {},
  status: {},
  name: {},
  number: {},
  cost: {},
  tax: {},
  priceWithTax: {},
  issueDate: {},
  account: { id: {}, name: {} },
  job: { id: {} },
  task: { id: {} },
};

function toTaskDocument(n: any): TaskDocument | null {
  if (!n?.id || !(TASK_DOC_TYPES as readonly string[]).includes(n.type)) return null;
  if (n.status === "denied") return null;
  const customer = String(n.type).startsWith("customer");
  const amount = customer
    ? Number(n.priceWithTax ?? 0)
    : Number(n.cost ?? 0) + Number(n.tax ?? 0);
  return {
    id: n.id,
    type: n.type,
    status: n.status ?? "",
    name: n.name ?? "",
    number: typeof n.number === "number" ? n.number : null,
    amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    issueDate: n.issueDate ?? null,
    accountName: n.account?.name ?? "",
    jobId: n.job?.id ?? "",
    taskId: n.task?.id ?? "",
    costCodes: [],
  };
}

/**
 * The cost codes on each document's lines, by document id. One flat read of
 * the org's cost items for those documents (never nested in a paged
 * documents read: PAVE_GOTCHAS two-phase rule), in chunks to keep the filter small.
 */
export async function getCostCodesByDocument(cfg: PaveConfig, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const rows = await pageAll<any>(cfg, {
      label: "organization.costItems (cost codes of documents)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          costItems: {
            $: { where: [["document", "id"], "in", chunk], ...args },
            nextPage: {},
            nodes: { document: { id: {} }, costCode: { number: {}, name: {} } },
          },
        },
      }),
      pick: (r) => r?.organization?.costItems,
    });
    for (const n of rows) {
      const doc = n?.document?.id;
      const num = n?.costCode?.number;
      if (!doc || !num) continue;
      (out.get(doc) ?? out.set(doc, new Set()).get(doc)!).add(`${num} ${n.costCode.name ?? ""}`.trim());
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

async function withCostCodes(cfg: PaveConfig, docs: TaskDocument[]): Promise<TaskDocument[]> {
  if (docs.length === 0) return docs;
  const codes = await getCostCodesByDocument(cfg, docs.map((d) => d.id)).catch(() => new Map<string, string[]>());
  return docs.map((d) => ({ ...d, costCodes: codes.get(d.id) ?? [] }));
}

/** Every counted document in the org that sits on a schedule task. */
export async function getTaskLinkedDocuments(cfg: PaveConfig): Promise<TaskDocument[]> {
  const rows = await pageAll<any>(cfg, {
    label: "organization.documents (on a task)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        documents: {
          $: {
            where: {
              and: [
                { "!=": [{ field: ["task", "id"] }, { value: null }] },
                ["type", "in", [...TASK_DOC_TYPES]],
              ],
            },
            ...args,
          },
          nextPage: {},
          nodes: DOC_FIELDS,
        },
      },
    }),
    pick: (r) => r?.organization?.documents,
  });
  return withCostCodes(cfg, rows.map(toTaskDocument).filter((d): d is TaskDocument => !!d && !!d.taskId));
}

/** One job's DRAFT documents that sit on no task: what a person can attach. */
export async function getJobDocumentsToLink(cfg: PaveConfig, jobId: string): Promise<TaskDocument[]> {
  const rows = await pageAll<any>(cfg, {
    label: "job.documents (to link)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        documents: {
          $: {
            where: {
              and: [
                { "=": [{ field: ["task", "id"] }, { value: null }] },
                ["status", "draft"],
              ],
            },
            sortBy: [{ field: "createdAt", order: "desc" }],
            ...args,
          },
          nextPage: {},
          nodes: DOC_FIELDS,
        },
      },
    }),
    pick: (r) => r?.job?.documents,
  });
  return withCostCodes(cfg, rows.map(toTaskDocument).filter((d): d is TaskDocument => !!d));
}

/** What the link write checks and compares: the document's identity and money. */
export interface DocForLink {
  id: string;
  orgId: string;
  type: string;
  status: string;
  jobId: string;
  taskId: string;
  externalId: string;
  cost: number;
  price: number;
}

export async function getDocumentForLink(cfg: PaveConfig, id: string): Promise<DocForLink | undefined> {
  const r = await pave(cfg, {
    document: {
      $: { id },
      id: {},
      type: {},
      status: {},
      externalId: {},
      cost: {},
      price: {},
      organization: { id: {} },
      job: { id: {} },
      task: { id: {} },
    },
  });
  const d = r?.document;
  if (!d?.id) return undefined;
  return {
    id: d.id,
    orgId: d.organization?.id ?? "",
    type: d.type ?? "",
    status: d.status ?? "",
    jobId: d.job?.id ?? "",
    taskId: d.task?.id ?? "",
    externalId: d.externalId ?? "",
    cost: Number(d.cost ?? 0),
    price: Number(d.price ?? 0),
  };
}

/** True when a write changed nothing but the task: status, cost, price and externalId all held. */
export function onlyTaskChanged(before: DocForLink, after: DocForLink): boolean {
  return (
    before.status === after.status &&
    before.externalId === after.externalId &&
    before.type === after.type &&
    before.jobId === after.jobId &&
    Math.abs(before.cost - after.cost) < 0.005 &&
    Math.abs(before.price - after.price) < 0.005
  );
}

/**
 * WRITE — put a document on a task, or take it off (`taskId: null`).
 * `updateDocument` with `taskId` only. The caller has already checked the
 * document and the task (src/app/api/schedule/links/route.ts).
 */
export async function setDocumentTask(cfg: PaveConfig, docId: string, taskId: string | null): Promise<void> {
  await pave(cfg, {
    updateDocument: { $: { id: docId, taskId }, document: { $: { id: docId }, id: {} } },
  });
}

/** A task's id and name, for the label on a bill that sits on it. */
export async function getTaskName(cfg: PaveConfig, id: string): Promise<{ id: string; name: string } | null> {
  const r = await pave(cfg, { task: { $: { id }, id: {}, name: {} } });
  return r?.task?.id ? { id: r.task.id, name: r.task.name ?? "" } : null;
}

/** One line of a document, for the details window. */
export interface DocLine {
  name: string;
  description: string;
  quantity: number | null;
  unitCost: number | null;
  /** Dollars: a customer line's price, a vendor line's cost. */
  amount: number;
  costCode: string;
}

export interface DocDetail {
  id: string;
  type: TaskDocType;
  status: string;
  name: string;
  number: number | null;
  subject: string;
  description: string;
  accountName: string;
  issueDate: string | null;
  dueDate: string | null;
  jobId: string;
  jobName: string;
  amount: number;
  tax: number;
  lines: DocLine[];
}

/** One document with its lines, for the details window. Undefined when it is not in this org. */
export async function getDocumentDetail(cfg: PaveConfig, id: string): Promise<DocDetail | undefined> {
  const r = await pave(cfg, {
    document: {
      $: { id },
      id: {},
      type: {},
      status: {},
      name: {},
      number: {},
      subject: {},
      description: {},
      issueDate: {},
      dueDate: {},
      cost: {},
      tax: {},
      priceWithTax: {},
      organization: { id: {} },
      account: { name: {} },
      job: { id: {}, name: {} },
    },
  });
  const d = r?.document;
  if (!d?.id || d.organization?.id !== cfg.orgId || !(TASK_DOC_TYPES as readonly string[]).includes(d.type)) return undefined;
  const customer = String(d.type).startsWith("customer");
  const rows = await pageAll<any>(cfg, {
    label: "document.costItems (details)",
    query: (args) => ({
      document: {
        $: { id },
        id: {},
        costItems: {
          $: { sortBy: [{ field: "position", order: "asc" }], ...args },
          nextPage: {},
          nodes: {
            name: {},
            description: {},
            quantity: {},
            unitCost: {},
            cost: {},
            price: {},
            costCode: { number: {}, name: {} },
          },
        },
      },
    }),
    pick: (x) => x?.document?.costItems,
  });
  const money2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
  return {
    id: d.id,
    type: d.type,
    status: d.status ?? "",
    name: d.name ?? "",
    number: typeof d.number === "number" ? d.number : null,
    subject: d.subject ?? "",
    description: d.description ?? "",
    accountName: d.account?.name ?? "",
    issueDate: d.issueDate ?? null,
    dueDate: d.dueDate ?? null,
    jobId: d.job?.id ?? "",
    jobName: d.job?.name ?? "",
    amount: customer ? money2(d.priceWithTax) : money2(Number(d.cost ?? 0) + Number(d.tax ?? 0)),
    tax: money2(d.tax),
    lines: rows.map((n) => ({
      name: n.name ?? "",
      description: n.description ?? "",
      quantity: typeof n.quantity === "number" ? n.quantity : null,
      unitCost: typeof n.unitCost === "number" ? n.unitCost : null,
      amount: money2(customer ? n.price : n.cost),
      costCode: n.costCode?.number ? `${n.costCode.number} ${n.costCode.name ?? ""}`.trim() : "",
    })),
  };
}
