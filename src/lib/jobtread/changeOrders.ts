// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import {
  CO_DOC_NAME,
  CO_LOG_EXTRA_IDS,
  CO_LOG_START,
  inLog,
  markupFromMargin,
  type CoHeader,
  type CoRow,
  type CoStatus,
} from "@/lib/changeOrders";
import { pageAll, pave, type PaveConfig } from "./core";

// ---------------------------------------------------------------------------
// CHANGE ORDERS — the log's read, the new-change-order form's read, and the
// one write: a DRAFT customer order named "Change Order". Rules and the
// createDocument input: src/lib/changeOrders.ts.
// ---------------------------------------------------------------------------

const STATUSES = new Set<CoStatus>(["draft", "pending", "approved", "denied"]);

/**
 * Every change order in the log, org-wide or for one job. Scalars only inside
 * the paged connection (job and account are single references), so it pages
 * at 100 with no 413 risk.
 */
export async function getChangeOrderLog(cfg: PaveConfig, jobId?: string): Promise<CoRow[]> {
  const since = { and: [["type", "customerOrder"], ["name", CO_DOC_NAME], ["createdAt", ">=", `${CO_LOG_START}T00:00:00Z`]] };
  const extra = CO_LOG_EXTRA_IDS.length ? { and: [["type", "customerOrder"], ["id", "in", [...CO_LOG_EXTRA_IDS]]] } : null;
  const where = extra ? { or: [since, extra] } : since;
  const nodes = {
    id: {},
    number: {},
    subject: {},
    status: {},
    price: {},
    priceWithTax: {},
    issueDate: {},
    createdAt: {},
    job: { id: {}, name: {}, number: {} },
    account: { name: {} },
  };
  const docs = await pageAll<any>(cfg, {
    label: "change orders",
    query: (args) =>
      jobId
        ? { job: { $: { id: jobId }, documents: { $: { where, ...args }, nextPage: {}, nodes } } }
        : { organization: { $: { id: cfg.orgId }, documents: { $: { where, ...args }, nextPage: {}, nodes } } },
    pick: (r) => (jobId ? r?.job?.documents : r?.organization?.documents),
  });
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return docs
    .map((d) => ({
      id: String(d.id ?? ""),
      number: d.number != null ? String(d.number) : "",
      title: String(d.subject ?? ""),
      status: (STATUSES.has(d.status) ? d.status : "draft") as CoStatus,
      price: num(d.price),
      total: typeof d.priceWithTax === "number" ? d.priceWithTax : num(d.price),
      issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : "",
      createdAt: String(d.createdAt ?? ""),
      jobId: String(d.job?.id ?? jobId ?? ""),
      jobName: String(d.job?.name ?? ""),
      jobNumber: d.job?.number != null ? String(d.job.number) : "",
      customer: String(d.account?.name ?? ""),
    }))
    .filter(inLog)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface CoFormData {
  header: CoHeader;
  /** cost × markup: the job's budget markup, else the cost types' own. */
  markup: number;
  codes: { id: string; number: string; name: string }[];
  costTypes: { id: string; name: string }[];
  /** The cost type a new line starts on. */
  defaultCostTypeId: string;
}

/**
 * What the new-change-order form needs for one job: the document header, the
 * markup, every cost code (divisions left out) and the cost types. Writes nothing.
 */
export async function getChangeOrderForm(cfg: PaveConfig, jobId: string): Promise<CoFormData> {
  const [head, codes] = await Promise.all([
    pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        name: {},
        address: {},
        costTypes: { $: { size: 50 }, nodes: { id: {}, name: {}, margin: {} } },
        units: { $: { size: 100 }, nodes: { id: {}, name: {} } },
      },
      job: {
        $: { id: jobId },
        id: {},
        location: { name: {}, address: {}, taxRate: {}, customTaxRate: {}, account: { name: {}, primaryContact: { name: {} } } },
        // The budget (cost items on no document) carries the job's markup.
        budget: {
          _: "costItems",
          $: { where: { and: [[["document", "id"], null], ["cost", "!=", 0]] } },
          cost: { _: "sum", $: "cost" },
          price: { _: "sum", $: "price" },
        },
      },
    }),
    pageAll<any>(cfg, {
      label: "organization.costCodes (change order form)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          costCodes: { $: { where: ["number", "not like", "% 00 00"], ...args }, nextPage: {}, nodes: { id: {}, number: {}, name: {} } },
        },
      }),
      pick: (r) => r?.organization?.costCodes,
    }),
  ]);
  const job = head?.job;
  if (!job?.id) throw new Error("JobTread has no such job.");
  const loc = job.location;
  if (!loc?.name || !loc?.address) throw new Error("This job has no location address, which JobTread needs on a change order.");
  const types: { id: string; name: string; margin: number | null }[] = (head?.organization?.costTypes?.nodes ?? []).map(
    (t: any) => ({ id: String(t.id), name: String(t.name ?? ""), margin: typeof t.margin === "number" ? t.margin : null }),
  );
  const sub = types.find((t) => t.name === "Subcontractor") ?? types[0];
  const budgetCost = Number(job.budget?.cost) || 0;
  const markup = budgetCost
    ? Math.round(((Number(job.budget?.price) || 0) / budgetCost) * 1e4) / 1e4
    : markupFromMargin(sub?.margin);
  const allowance = (head?.organization?.units?.nodes ?? []).find((u: any) => u.name === "Allowance");
  return {
    header: {
      fromName: head?.organization?.name || "Ascent Building Co.",
      fromAddress: head?.organization?.address ?? null,
      toName: loc.account?.primaryContact?.name || loc.account?.name || "Customer",
      toAddress: loc.address,
      jobLocationName: loc.name,
      jobLocationAddress: loc.address,
      taxRate: loc.customTaxRate ?? loc.taxRate ?? 0,
      unitId: allowance?.id ?? null,
    },
    markup: markup >= 1 ? markup : 1,
    codes: codes
      .map((c) => ({ id: String(c.id), number: String(c.number ?? "").trim(), name: String(c.name ?? "") }))
      .filter((c) => c.number)
      .sort((a, b) => a.number.localeCompare(b.number)),
    costTypes: types.map(({ id, name }) => ({ id, name })),
    defaultCostTypeId: sub?.id ?? "",
  };
}

/**
 * WRITE — create the draft change order, then read it back. A draft counts
 * toward nothing until the client approves it in JobTread.
 */
export async function createChangeOrder(
  cfg: PaveConfig,
  input: Record<string, unknown>,
): Promise<{ id: string; number: string; price: number; url: string }> {
  const r = await pave(cfg, {
    createDocument: { $: input, createdDocument: { id: {}, number: {}, price: {}, job: { id: {} } } },
  });
  const d = r?.createDocument?.createdDocument;
  if (!d?.id) throw new Error("JobTread created no change order.");
  const jobId = String(d.job?.id ?? input.jobId ?? "");
  return {
    id: String(d.id),
    number: d.number != null ? String(d.number) : "",
    price: typeof d.price === "number" ? d.price : 0,
    url: `https://app.jobtread.com/jobs/${jobId}/documents/${d.id}`,
  };
}
