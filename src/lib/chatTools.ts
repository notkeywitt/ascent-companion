/**
 * Chat tool registry — the read-only JobTread surface exposed to the Claude chat
 * assistant. Each tool is a thin wrapper over a verified read function in
 * jobtread.ts, so the assistant inherits every confirmed Pave gotcha (413
 * two-phase fetch, nextPage pagination, Uncategorized-rollup skipping,
 * client-side externalId filtering) for free.
 *
 * PHASE 1 IS READ-ONLY. Do NOT add any write function (updateLine, createLine,
 * setBill*, createVendorBill, …) here — writes come later behind writesEnabled()
 * plus an explicit confirmation step, so the chat can never fight the hourly
 * JT→sheet mirror.
 *
 * Server-only (the grant key lives in getPaveConfig). Never import from a client
 * component.
 */

import {
  type PaveConfig,
  getJobs,
  getJobBudget,
  getJobDocumentRollup,
  computeUnbilled,
  getDraftBills,
  getAllDraftBills,
  getBillDetail,
  getBillFiles,
  getVendors,
  getCostToComplete,
  type DraftBill,
} from "@/lib/jobtread";

export interface ChatToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export interface ChatTool extends ChatToolDef {
  handler: (cfg: PaveConfig, input: Record<string, unknown>) => Promise<unknown>;
}

/** A bill's amount owed = the pre-tax line subtotal (`cost` = Σ line cost) PLUS the
 *  document sales tax (`nonRecoverableTax`), which sits ON TOP of the line costs
 *  (confirmed live 2026-07-29). Matches the bill page's total. */
const billAmount = (b: DraftBill) => (b.cost ?? 0) + (b.nonRecoverableTax ?? 0);

const compactBill = (b: DraftBill) => ({
  docId: b.id,
  vendor: b.fromName ?? b.subject ?? "",
  invoiceId: b.externalId ?? b.number ?? "",
  amount: billAmount(b),
  issueDate: b.issueDate ?? "",
  status: b.status ?? "",
  jobId: b.jobId ?? undefined,
  jobName: b.jobName ?? undefined,
});

export const CHAT_TOOLS: ChatTool[] = [
  {
    name: "list_jobs",
    description:
      "List the organization's jobs (id, name, number, customer, address). Use this " +
      "to resolve a job the user names in words (e.g. 'the Miller job') into a job_id " +
      "before calling a job-scoped tool. Open jobs only unless include_closed is true.",
    input_schema: {
      type: "object",
      properties: {
        include_closed: {
          type: "boolean",
          description: "Include closed jobs too. Defaults to false (open jobs only).",
        },
      },
      additionalProperties: false,
    },
    handler: async (cfg, input) => {
      const jobs = await getJobs(cfg, input.include_closed === true);
      return jobs.map((j) => ({
        jobId: j.id,
        name: j.name,
        number: j.number ?? "",
        customer: j.customer ?? "",
        address: j.address ?? "",
      }));
    },
  },
  {
    name: "get_unbilled",
    description:
      "Get a job's billing rollup: total approved vendor-bill cost, invoiced cost, " +
      "draft (uncoded) bill cost, draft invoice cost, and the resulting unbilled " +
      "amount (approved cost not yet on an approved customer invoice). Requires a job_id.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string", description: "The JobTread job id." } },
      required: ["job_id"],
      additionalProperties: false,
    },
    handler: async (cfg, input) => {
      const rollup = await getJobDocumentRollup(cfg, String(input.job_id));
      return computeUnbilled(rollup);
    },
  },
  {
    name: "get_coding_queue",
    description:
      "List draft vendor bills waiting to be coded/reviewed. With job_id, that job's " +
      "drafts; without job_id, every job's drafts (each tagged with its job). Each bill " +
      "carries its docId, vendor, invoiceId, amount owed, issue date, and status.",
    input_schema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "Optional. Narrow to one job's draft bills; omit for all jobs.",
        },
      },
      additionalProperties: false,
    },
    handler: async (cfg, input) => {
      const jobId = input.job_id ? String(input.job_id).trim() : "";
      const bills = jobId ? await getDraftBills(cfg, jobId) : await getAllDraftBills(cfg);
      const rows = bills.map(compactBill);
      return {
        count: rows.length,
        totalAmount: rows.reduce((s, r) => s + r.amount, 0),
        bills: rows,
      };
    },
  },
  {
    name: "get_bill_detail",
    description:
      "Get one vendor bill's full detail by its document id: header (vendor, invoice id, " +
      "status, issue date; `cost` is the pre-tax subtotal = sum of line costs, and " +
      "`nonRecoverableTax` is the sales tax on top, so amount owed = cost + nonRecoverableTax) " +
      "plus every line item (name, cost, cost code, current coding) and any attached invoice files.",
    input_schema: {
      type: "object",
      properties: { doc_id: { type: "string", description: "The JobTread document id of the bill." } },
      required: ["doc_id"],
      additionalProperties: false,
    },
    handler: async (cfg, input) => {
      const docId = String(input.doc_id);
      const [detail, files] = await Promise.all([
        getBillDetail(cfg, docId),
        getBillFiles(cfg, docId),
      ]);
      return {
        header: detail.header,
        lines: detail.lines.map((l) => ({
          id: l.id,
          name: l.name ?? "",
          cost: l.cost ?? 0,
          quantity: l.quantity ?? undefined,
          unitCost: l.unitCost ?? undefined,
          costCode: l.costCode?.number ?? "",
          costCodeName: l.costCode?.name ?? "",
          coded: Boolean(l.jobCostItem?.id),
        })),
        files: files.map((f) => ({ name: f.name ?? "", url: f.url ?? "" })),
      };
    },
  },
  {
    name: "get_job_budget",
    description:
      "List a job's budget leaves (the valid coding targets): each cost code number and " +
      "name. Use this to answer questions about what codes exist on a job's budget. " +
      "Requires a job_id.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string", description: "The JobTread job id." } },
      required: ["job_id"],
      additionalProperties: false,
    },
    handler: async (cfg, input) => {
      const items = await getJobBudget(cfg, String(input.job_id));
      return items.map((i) => ({ code: i.number, name: i.name }));
    },
  },
  {
    name: "get_cost_to_complete",
    description:
      "Get a job's cost-to-complete per cost code: budget (estimate), actual " +
      "(approved+pending vendor-bill cost), and remaining (budget − actual; negative = " +
      "over budget). Requires a job_id.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string", description: "The JobTread job id." } },
      required: ["job_id"],
      additionalProperties: false,
    },
    handler: async (cfg, input) => {
      const byCode = await getCostToComplete(cfg, String(input.job_id));
      return Object.entries(byCode)
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => a.remaining - b.remaining); // most over-budget first
    },
  },
  {
    name: "list_vendors",
    description:
      "List the organization's vendor accounts (id and name). Useful for resolving or " +
      "confirming a vendor the user names.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (cfg) => {
      const vendors = await getVendors(cfg);
      return vendors.map((v) => ({ vendorId: v.id, name: v.name }));
    },
  },
];

const BY_NAME = new Map(CHAT_TOOLS.map((t) => [t.name, t]));

export function toolByName(name: string): ChatTool | undefined {
  return BY_NAME.get(name);
}

/** The tool definitions in the shape the Anthropic Messages API expects. */
export function anthropicToolDefs(): ChatToolDef[] {
  return CHAT_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}
