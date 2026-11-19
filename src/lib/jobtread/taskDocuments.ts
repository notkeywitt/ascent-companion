// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, pave, type PaveConfig } from "./core";

// ---------------------------------------------------------------------------
// DOCUMENTS ON SCHEDULE TASKS — JobTread's own link (`document.task`)
// ---------------------------------------------------------------------------
//
// A bill, an estimate, a vendor order or a bid request can carry one schedule
// task (`taskId` on createDocument / updateDocument; `task.documents` reads it
// back). The Schedule page shows the link and sets it (docs/plans/SCHEDULE_PLAN.md,
// stage 4). Nothing else in the app reads or writes `document.task`.
//
// Reads page the org's documents with a task, with NO nested connection
// (PAVE_GOTCHAS: two-phase rule). A voided bill (`denied`) is left out: it
// stops counting everywhere.

/** The document types that can sit on a task. An invoice is not one of them. */
export const TASK_DOC_TYPES = ["vendorBill", "customerOrder", "vendorOrder", "bidRequest"] as const;
export type TaskDocType = (typeof TASK_DOC_TYPES)[number];

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
  };
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
  return rows.map(toTaskDocument).filter((d): d is TaskDocument => !!d && !!d.taskId);
}

/** One job's counted documents that sit on NO task: what a person can attach. */
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
                ["type", "in", [...TASK_DOC_TYPES]],
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
  return rows.map(toTaskDocument).filter((d): d is TaskDocument => !!d);
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
