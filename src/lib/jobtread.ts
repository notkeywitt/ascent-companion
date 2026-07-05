/**
 * JobTread Pave API client — the verified calls behind the companion tool.
 *
 * Every query/mutation here was confirmed live against the Pave API in July 2026
 * (see ascent-appscript/CLAUDE.md "Companion-tool findings" and the `_invp*`
 * probes in Diagnostics.js). Field names marked TODO are NOT yet verified — do
 * not ship them until confirmed (probe-first rule).
 *
 * The grant key stays server-side. Import this only from server code / route
 * handlers, never from the browser.
 */

const PAVE_URL = "https://api.jobtread.com/pave";

export interface PaveConfig {
  grantKey: string; // JT_GRANT_KEY
  orgId: string; // JT_ORG_ID, e.g. "22PXG7QcMaQ2"
}

/** Low-level Pave call. `query` is the Pave query object (grantKey injected here). */
export async function pave<T = any>(cfg: PaveConfig, query: Record<string, unknown>): Promise<T> {
  const body = { query: { $: { grantKey: cfg.grantKey }, ...query } };
  const res = await fetch(PAVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json?.errors) {
    const msg = json?.errors?.map((e: any) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(`Pave error: ${msg}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// UNBILLED EXPENSES  (confirmed: documents carry cost/price/priceWithTax and
// support server-side group/sum by type+status)
// ---------------------------------------------------------------------------

export interface DocRollupRow {
  type: string; // vendorBill | customerInvoice | customerOrder | ...
  status: string; // draft | pending | approved | denied
  cost: number;
  priceWithTax: number;
  count: number;
}

/** Job-level cost/price rollup grouped by document type + status. */
export async function getJobDocumentRollup(cfg: PaveConfig, jobId: string): Promise<DocRollupRow[]> {
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      id: {},
      documents: {
        $: {
          group: {
            by: ["type", "status"],
            aggs: {
              cost: { sum: "cost" },
              priceWithTax: { sum: "priceWithTax" },
              count: { count: [] },
            },
          },
        },
        withValues: {},
      },
    },
  });
  return (r?.job?.documents?.withValues ?? []) as DocRollupRow[];
}

/**
 * Unbilled cost = Σ approved vendorBill.cost − Σ customerInvoice.cost
 * (draft invoices count as "in progress" — surfaced separately).
 */
export function computeUnbilled(rollup: DocRollupRow[]) {
  const sum = (type: string, statuses: string[]) =>
    rollup
      .filter((r) => r.type === type && statuses.includes(r.status))
      .reduce((s, r) => s + (r.cost ?? 0), 0);

  const billedCost = sum("vendorBill", ["approved"]);
  const invoicedCost = sum("customerInvoice", ["approved"]);
  const draftInvoiceCost = sum("customerInvoice", ["draft"]);
  const draftBillCost = sum("vendorBill", ["draft"]); // = the coding queue value

  return {
    billedCost,
    invoicedCost,
    draftInvoiceCost,
    draftBillCost,
    unbilled: billedCost - invoicedCost, // approved cost not yet on an approved invoice
  };
}

// TODO(per-cost-code): same idea grouped by costCode.number on the cost items of
// each doc type, to show unbilled per code. Confirm the costItems group shape.

// ---------------------------------------------------------------------------
// CODING QUEUE  (confirmed: vendorBill/draft docs; line target = jobCostItem)
// ---------------------------------------------------------------------------

/** Draft vendor bills on a job — the review/coding queue. */
export async function getDraftBills(cfg: PaveConfig, jobId: string) {
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      id: {},
      documents: {
        $: { where: { and: [["type", "vendorBill"], ["status", "draft"]] }, size: 100 },
        nextPage: {},
        nodes: { id: {}, name: {}, status: {}, cost: {}, issueDate: {} },
      },
    },
  });
  return r?.job?.documents?.nodes ?? [];
}

/** A bill's lines with their current coding (jobCostItem) + cost code. */
export async function getBillLines(cfg: PaveConfig, docId: string) {
  const r = await pave(cfg, {
    document: {
      $: { id: docId },
      id: {},
      costItems: {
        $: { size: 100 },
        nodes: {
          id: {},
          name: {},
          cost: {},
          costCode: { number: {}, name: {} },
          jobCostItem: { id: {} }, // ← the coding target (budget cost item)
        },
      },
    },
  });
  return r?.document?.costItems?.nodes ?? [];
}

// TODO(coding write): set a line's jobCostItem. The Apps Script suite already
// does this — mirror the updateCostItem / updateDocument mutation shape from
// ascent-appscript/JobTread.js (scanAndPushCodingUpdates / pushCodingUpdate)
// once ported. Keep the DRY_RUN gate.

// ---------------------------------------------------------------------------
// INVOICE STAGING  (confirmed mechanism: createDocument type customerInvoice;
// the exact lineItems shape is the one remaining detail to lock)
// ---------------------------------------------------------------------------

export interface StageInvoiceInput {
  jobId: string;
  accountId: string; // customer account
  issueDate: string; // YYYY-MM-DD
  // TODO(lineItems): confirm how unbilled costs + markup become invoice lines by
  // reading one existing customerInvoice's line structure. Placeholder below.
  lineItems: unknown[];
}

/** Create a DRAFT customer invoice (owner reviews/sends inside JobTread). */
export async function createDraftInvoice(cfg: PaveConfig, input: StageInvoiceInput) {
  // Mechanism confirmed (createDocument + type). lineItems shape TODO.
  return pave(cfg, {
    createDocument: {
      $: {
        type: "customerInvoice",
        status: "draft",
        jobId: input.jobId,
        accountId: input.accountId,
        organizationId: cfg.orgId,
        issueDate: input.issueDate,
        lineItems: input.lineItems,
      },
      createdDocument: { id: {}, type: {}, status: {} },
    },
  });
}
