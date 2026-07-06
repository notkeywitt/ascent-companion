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
  companyName?: string; // issuer name for customer invoices (fromName)
}

/** Low-level Pave call. `query` is the Pave query object (grantKey injected here). */
export async function pave<T = any>(cfg: PaveConfig, query: Record<string, unknown>): Promise<T> {
  const body = { query: { $: { grantKey: cfg.grantKey }, ...query } };
  const res = await fetch(PAVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // JobTread returns plain text for some errors (e.g. a bad grant key ->
  // "Supplied key is invalid"), so parse defensively rather than assume JSON.
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || json === null || json?.errors) {
    const msg =
      json?.errors?.map((e: any) => e.message).join("; ") ??
      (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    throw new Error(`Pave error (HTTP ${res.status}): ${msg}`);
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

export interface DraftBill {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string; // vendor name
  number?: string; // JobTread document number
  externalId?: string; // the ingested ExpID / vendor invoice number
  status?: string;
  cost?: number;
  issueDate?: string;
}

/** Draft vendor bills on a job — the review/coding queue. */
export async function getDraftBills(cfg: PaveConfig, jobId: string): Promise<DraftBill[]> {
  const q = (nodes: Record<string, unknown>) => ({
    job: {
      $: { id: jobId },
      id: {},
      documents: {
        $: { where: { and: [["type", "vendorBill"], ["status", "draft"]] }, size: 100 },
        nextPage: {},
        nodes,
      },
    },
  });
  const rich = {
    id: {}, name: {}, subject: {}, fromName: {}, number: {}, externalId: {}, status: {}, cost: {}, issueDate: {},
  };
  const min = { id: {}, name: {}, status: {}, cost: {}, issueDate: {} };
  let r: any;
  try {
    r = await pave(cfg, q(rich));
  } catch {
    r = await pave(cfg, q(min)); // an unconfirmed field name won't break the queue
  }
  return r?.job?.documents?.nodes ?? [];
}

export interface BillLine {
  id: string;
  name?: string;
  cost?: number;
  quantity?: number;
  unitCost?: number;
  costCode?: { number?: string; name?: string } | null;
  jobCostItem?: { id?: string } | null;
}
export interface BillDetail {
  header: {
    id: string;
    name?: string;
    subject?: string;
    fromName?: string;
    number?: string;
    externalId?: string;
    status?: string;
    cost?: number;
    issueDate?: string;
  };
  lines: BillLine[];
}

/** A bill's header + lines (with current coding). Rich header falls back to minimal. */
export async function getBillDetail(cfg: PaveConfig, docId: string): Promise<BillDetail> {
  const lineSel = {
    costItems: {
      $: { size: 100 },
      nodes: {
        id: {},
        name: {},
        cost: {},
        quantity: {},
        unitCost: {},
        costCode: { number: {}, name: {} },
        jobCostItem: { id: {} }, // ← the coding target (budget cost item)
      },
    },
  };
  const rich = {
    document: {
      $: { id: docId },
      id: {}, name: {}, status: {}, cost: {}, issueDate: {}, subject: {}, fromName: {}, number: {}, externalId: {},
      ...lineSel,
    },
  };
  const min = {
    document: { $: { id: docId }, id: {}, name: {}, status: {}, cost: {}, issueDate: {}, ...lineSel },
  };
  let d: any;
  try {
    d = (await pave(cfg, rich))?.document;
  } catch {
    d = (await pave(cfg, min))?.document;
  }
  d = d ?? {};
  return {
    header: {
      id: d.id,
      name: d.name,
      subject: d.subject,
      fromName: d.fromName,
      number: d.number,
      externalId: d.externalId,
      status: d.status,
      cost: d.cost,
      issueDate: d.issueDate,
    },
    lines: d.costItems?.nodes ?? [],
  };
}

export interface BillFile {
  id: string;
  name?: string;
  type?: string;
  url?: string;
}

/** Files attached to a bill (the invoice PDF/image). Defensive — [] on any error. */
export async function getBillFiles(cfg: PaveConfig, docId: string): Promise<BillFile[]> {
  try {
    const r = await pave(cfg, {
      document: {
        $: { id: docId },
        id: {},
        files: { $: { size: 20 }, nodes: { id: {}, name: {}, type: {}, url: {} } },
      },
    });
    return r?.document?.files?.nodes ?? [];
  } catch {
    return [];
  }
}

/**
 * WRITE — set a bill's issueDate (used to stamp its billing month as the last day
 * of that month, matching the Apps Script convention). Never touches lineItems
 * (updateDocument with lineItems wipes cost items — CLAUDE.md).
 */
export async function setBillIssueDate(
  cfg: PaveConfig,
  docId: string,
  issueDate: string,
): Promise<string> {
  const r = await pave(cfg, {
    updateDocument: {
      $: { id: docId, issueDate },
      document: { $: { id: docId }, id: {}, issueDate: {} },
    },
  });
  return r?.updateDocument?.document?.issueDate ?? issueDate;
}

export interface BudgetItem {
  id: string; // jobCostItemId — the coding target
  number: string; // cost code, e.g. "06 10 00" (or a free label like "Office Admin")
  name: string;
}

/**
 * The job's budget leaves (coding targets), for the cost-code dropdown. Mirrors
 * the Apps Script budget mapper: paginate job.costItems, skip bill-child items
 * (those carry a document id) and JobTread's auto "Uncategorized <code>" rollups.
 */
export async function getJobBudget(cfg: PaveConfig, jobId: string): Promise<BudgetItem[]> {
  const items: BudgetItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            document: { id: {} },
            costCode: { number: {}, name: {} },
          },
        },
      },
    });
    const co = r?.job?.costItems ?? {};
    for (const n of co.nodes ?? []) {
      if (n?.document?.id) continue; // bill-child cost item, not a budget leaf
      if (/^uncategorized\b/i.test(String(n?.name ?? "").trim())) continue;
      const number = n?.costCode?.number?.toString().trim();
      if (!number) continue;
      items.push({ id: n.id, number, name: n?.costCode?.name ?? n?.name ?? "" });
    }
    cursor = co.nextPage ?? null;
    if (!cursor) break;
  }
  // stable sort by code for the dropdown
  return items.sort((a, b) => a.number.localeCompare(b.number));
}

export interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string; // job.location.account.name
  closedOn?: string | null;
}

/** Org's jobs for the picker. Open jobs only by default, sorted by customer/name. */
export async function getJobs(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
  const out: JobRef[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        id: {},
        jobs: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            number: {},
            closedOn: {},
            location: { account: { name: {} } },
          },
        },
      },
    });
    const jc = r?.organization?.jobs ?? {};
    for (const n of jc.nodes ?? []) {
      if (!includeClosed && n.closedOn) continue;
      out.push({
        id: n.id,
        name: n.name,
        number: n.number,
        customer: n.location?.account?.name ?? "",
        closedOn: n.closedOn,
      });
    }
    cursor = jc.nextPage ?? null;
    if (!cursor) break;
  }
  return out.sort(
    (a, b) =>
      (a.customer ?? "").localeCompare(b.customer ?? "") || (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export interface VendorRef {
  id: string;
  name: string;
}

/** Org's vendor accounts (for the RFI assignee dropdown), sorted by name. */
export async function getVendors(cfg: PaveConfig): Promise<VendorRef[]> {
  const out: VendorRef[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const args: Record<string, unknown> = {
      where: { and: [["type", "vendor"]] },
      size: 100,
      sortBy: [{ field: "name" }],
    };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        id: {},
        accounts: { $: args, nextPage: {}, nodes: { id: {}, name: {} } },
      },
    });
    const ac = r?.organization?.accounts ?? {};
    for (const n of ac.nodes ?? []) out.push({ id: n.id, name: n.name });
    cursor = ac.nextPage ?? null;
    if (!cursor) break;
  }
  return out;
}

/**
 * WRITE — update a bill line: its coding (jobCostItemId), quantity, and/or
 * unitCost. Confirmed production mutation (ascent-appscript JobTread.js):
 * updateCostItem accepts all three. Callers must gate this behind the
 * writes-enabled flag; a customer bill is shared with the AppSheet flow, so
 * nothing here runs until that coordination is settled.
 */
export async function updateLine(
  cfg: PaveConfig,
  costItemId: string,
  fields: { jobCostItemId?: string; quantity?: number; unitCost?: number },
): Promise<{ id: string }> {
  const $: Record<string, unknown> = { id: costItemId };
  if (fields.jobCostItemId !== undefined) $.jobCostItemId = fields.jobCostItemId;
  if (fields.quantity !== undefined) $.quantity = fields.quantity;
  if (fields.unitCost !== undefined) $.unitCost = fields.unitCost;
  const r = await pave(cfg, {
    updateCostItem: { $, costItem: { $: { id: costItemId }, id: {} } },
  });
  return { id: r?.updateCostItem?.costItem?.id ?? costItemId };
}

// ---------------------------------------------------------------------------
// INVOICE STAGING  (confirmed mechanism: createDocument type customerInvoice;
// the exact lineItems shape is the one remaining detail to lock)
// ---------------------------------------------------------------------------

/**
 * A customer-invoice line. Confirmed by reading invoice 22PYV7jiDvHs: each line
 * mirrors a vendor-bill line — a costCode, a jobCostItem (the budget leaf), a
 * cost basis, and a price (= cost × fee; that invoice ran a uniform 18% markup).
 * One line per budget leaf. Input uses ids (like jobId/accountId elsewhere).
 */
export interface InvoiceLine {
  name: string;
  jobCostItemId?: string; // budget cost item (optional for per-bill lines)
  costCodeId?: string;
  cost: number;
  price?: number; // omitted -> JobTread applies the job fee
}

export interface StageInvoiceInput {
  jobId: string;
  issueDate: string; // YYYY-MM-DD (last day of the billing month)
}

/**
 * Create a DRAFT customer invoice. JobTread's create-invoice auto-pulls the job's
 * uninvoiced Bills & Time — we pass NO line items; it populates itself. The owner
 * reviews/sends it inside JobTread. Our staging view is just a sanity check.
 */
export async function createDraftInvoice(cfg: PaveConfig, input: StageInvoiceInput) {
  return pave(cfg, {
    createDocument: {
      $: {
        type: "customerInvoice",
        status: "draft",
        jobId: input.jobId,
        organizationId: cfg.orgId,
        issueDate: input.issueDate,
        // JobTread requires a non-null fromName on the document. A customer
        // invoice is issued BY us, so the "from" party is our company.
        fromName: cfg.companyName ?? "Ascent Building Co.",
      },
      createdDocument: { id: {}, type: {}, status: {} },
    },
  });
}

export interface StageLine {
  key: string;
  label: string; // vendor (+ invoice id), or the rolled-up Sunset group
  cost: number;
  billIds: string[];
  isSunset: boolean;
}
export interface MonthlyStaging {
  customer: { id: string; name: string } | null;
  lines: StageLine[];
}

/**
 * Bills to invoice for a job + billing month: approved vendor bills whose
 * issueDate falls in the month (= the billing month). Sunset invoices are rolled
 * into ONE line; every other bill is its own line.
 */
export async function getMonthlyBills(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<MonthlyStaging> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      id: {},
      documents: {
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["status", "approved"],
              ["issueDate", ">=", first],
              ["issueDate", "<=", last],
            ],
          },
          size: 100,
        },
        nextPage: {},
        nodes: { id: {}, cost: {}, fromName: {}, number: {}, externalId: {}, account: { name: {} } },
      },
    },
  });
  const bills = (r?.job?.documents?.nodes ?? []) as any[];

  const vendorOf = (b: any) => String(b.account?.name ?? b.fromName ?? "Vendor");
  const isSunset = (b: any) => /sunset/i.test(vendorOf(b));
  const sunset = bills.filter(isSunset);
  const others = bills.filter((b) => !isSunset(b));

  const lines: StageLine[] = [];
  if (sunset.length) {
    lines.push({
      key: "sunset",
      label: `Sunset Builders Supply (${sunset.length} invoice${sunset.length > 1 ? "s" : ""})`,
      cost: sunset.reduce((s, b) => s + (b.cost ?? 0), 0),
      billIds: sunset.map((b) => b.id),
      isSunset: true,
    });
  }
  for (const b of others) {
    const inv = b.externalId || (b.number ? `#${b.number}` : "");
    lines.push({
      key: b.id,
      label: `${vendorOf(b)}${inv ? ` · ${inv}` : ""}`,
      cost: b.cost ?? 0,
      billIds: [b.id],
      isSunset: false,
    });
  }
  lines.sort((a, b) => b.cost - a.cost);

  const c = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, location: { account: { id: {}, name: {} } } },
  });
  const acc = c?.job?.location?.account;
  const customer = acc?.id ? { id: acc.id, name: acc.name ?? "" } : null;

  return { customer, lines };
}

/**
 * Uninvoiced remainder per cost code — this is what "Create draft invoice" will
 * actually pull. Confirmed (probes, 2026-07): JobTread has NO per-bill "invoiced"
 * flag; a customer invoice has one line per budget cost code with sourceCostItem
 * null. It nets per cost code: remainder = Σ approved vendorBill cost − Σ customer
 * invoice cost. Fully-invoiced codes net to 0 and drop out; that is how JT
 * "discriminates" already-invoiced cost. There is no month dimension — a new
 * invoice pulls ALL uninvoiced cost, so this is job-wide (the month only sets the
 * invoice's issueDate).
 *
 * Uses the flat job.costItems connection (nested costItems in paged documents
 * 413s) and filters out budget leaves (document == null). Invoiced counts ANY
 * customer-invoice status (draft/pending/approved) so cost already on a staged
 * draft isn't re-shown.
 */
export interface UninvoicedLine {
  code: string; // costCode.number
  name: string; // costCode.name
  billed: number; // Σ approved vendorBill cost
  invoiced: number; // Σ customerInvoice cost (any status)
  remainder: number; // billed − invoiced (> 0)
}
export interface UninvoicedStaging {
  customer: { id: string; name: string } | null;
  lines: UninvoicedLine[]; // positive remainders, largest first
  total: number; // Σ shown remainders
  netTotal: number; // job-level billed − invoiced (may differ from total if codes were recoded between bill and invoice)
}

export async function getUninvoicedByCostCode(
  cfg: PaveConfig,
  jobId: string,
): Promise<UninvoicedStaging> {
  let nodes: any[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: {
            cost: {},
            costCode: { number: {}, name: {} },
            document: { type: {}, status: {} },
          },
        },
      },
    });
    nodes = nodes.concat(r?.job?.costItems?.nodes ?? []);
    page = r?.job?.costItems?.nextPage || undefined;
  } while (page && ++guard < 50);

  const bill = new Map<string, number>();
  const inv = new Map<string, number>();
  const names = new Map<string, string>();
  for (const n of nodes) {
    if (!n.document) continue; // budget leaf, not a bill/invoice line
    const code = n.costCode?.number ?? "(uncoded)";
    if (n.costCode?.name) names.set(code, n.costCode.name);
    const c = n.cost ?? 0;
    if (n.document.type === "vendorBill" && n.document.status === "approved") {
      bill.set(code, (bill.get(code) ?? 0) + c);
    } else if (n.document.type === "customerInvoice") {
      inv.set(code, (inv.get(code) ?? 0) + c);
    }
  }

  const lines: UninvoicedLine[] = [];
  let netTotal = 0;
  for (const code of new Set([...bill.keys(), ...inv.keys()])) {
    const b = bill.get(code) ?? 0;
    const i = inv.get(code) ?? 0;
    const remainder = b - i;
    netTotal += remainder;
    if (remainder > 0.005) {
      lines.push({ code, name: names.get(code) ?? "", billed: b, invoiced: i, remainder });
    }
  }
  lines.sort((a, b) => b.remainder - a.remainder);
  const total = lines.reduce((s, l) => s + l.remainder, 0);

  const c = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, location: { account: { id: {}, name: {} } } },
  });
  const acc = c?.job?.location?.account;
  const customer = acc?.id ? { id: acc.id, name: acc.name ?? "" } : null;

  return { customer, lines, total, netTotal };
}

