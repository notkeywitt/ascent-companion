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
 * Unbilled cost = Σ approved vendorBill.cost − Σ customerInvoice.cost.
 *
 * Status policy (keep in sync with getUninvoicedBills): bills count once
 * APPROVED; customer invoices net at ANY status (draft/pending/approved) —
 * a bill pulled onto a draft invoice is already staged, so counting only
 * approved invoices would double-show it here while the staging page hides it.
 */
export function computeUnbilled(rollup: DocRollupRow[]) {
  const sum = (type: string, statuses: string[]) =>
    rollup
      .filter((r) => r.type === type && statuses.includes(r.status))
      .reduce((s, r) => s + (r.cost ?? 0), 0);

  const billedCost = sum("vendorBill", ["approved"]);
  const invoicedCost = sum("customerInvoice", ["draft", "pending", "approved"]);
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

/** Draft vendor bills on a job — the review/coding queue. Paginates (the Pave
 *  page cap is 100; a busy job's queue must not silently truncate). */
export async function getDraftBills(cfg: PaveConfig, jobId: string): Promise<DraftBill[]> {
  const q = (nodes: Record<string, unknown>, page?: string) => ({
    job: {
      $: { id: jobId },
      id: {},
      documents: {
        $: {
          where: { and: [["type", "vendorBill"], ["status", "draft"]] },
          size: 100,
          ...(page ? { page } : {}),
        },
        nextPage: {},
        nodes,
      },
    },
  });
  const rich = {
    id: {}, name: {}, subject: {}, fromName: {}, number: {}, externalId: {}, status: {}, cost: {}, issueDate: {},
  };
  const min = { id: {}, name: {}, status: {}, cost: {}, issueDate: {} };
  let nodes = rich;
  const out: DraftBill[] = [];
  let page: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    let r: any;
    try {
      r = await pave(cfg, q(nodes, page));
    } catch {
      nodes = min as typeof rich; // an unconfirmed field name won't break the queue
      r = await pave(cfg, q(nodes, page));
    }
    const conn = r?.job?.documents ?? {};
    out.push(...(conn.nodes ?? []));
    page = conn.nextPage || undefined;
    if (!page) break;
  }
  return out;
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
    qboIsIgnored?: boolean;
  };
  lines: BillLine[];
}

/** A bill's header + lines (with current coding). Rich header falls back to minimal. */
export async function getBillDetail(cfg: PaveConfig, docId: string): Promise<BillDetail> {
  const lineSel = {
    costItems: {
      $: { size: 100 },
      nextPage: {},
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
      qboIsIgnored: {},
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
  // Follow the cursor past the 100-line page cap (big statements) so the page
  // total always matches the header cost.
  let lines: BillLine[] = d.costItems?.nodes ?? [];
  let cursor: string | undefined = d.costItems?.nextPage || undefined;
  for (let guard = 0; cursor && guard < 50; guard++) {
    const r: any = await pave(cfg, {
      document: {
        $: { id: docId },
        id: {},
        costItems: {
          $: { size: 100, page: cursor },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            cost: {},
            quantity: {},
            unitCost: {},
            costCode: { number: {}, name: {} },
            jobCostItem: { id: {} },
          },
        },
      },
    });
    const conn = r?.document?.costItems ?? {};
    lines = lines.concat(conn.nodes ?? []);
    cursor = conn.nextPage || undefined;
  }
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
      qboIsIgnored: d.qboIsIgnored,
    },
    lines,
  };
}

/**
 * WRITE — set a bill's header flags. `name` is "Bill" | "Expense" (the JT doc
 * name / template), `qboDocumentType` is how it SYNCS to QuickBooks ("bill" vs
 * "purchase" = expense) — changing name alone doesn't change the QBO type, so the
 * Bill/Expense toggle sets both. `qboIsIgnored` controls Push to QuickBooks
 * (ignored = NOT pushed, so Push-to-QB = !qboIsIgnored). Never touches lineItems.
 */
export async function setBillFields(
  cfg: PaveConfig,
  docId: string,
  fields: { name?: string; qboIsIgnored?: boolean; qboDocumentType?: string },
): Promise<{ name?: string; qboIsIgnored?: boolean; qboDocumentType?: string }> {
  const r = await pave(cfg, {
    updateDocument: {
      $: { id: docId, ...fields },
      document: { $: { id: docId }, id: {}, name: {}, qboIsIgnored: {}, qboDocumentType: {} },
    },
  });
  const d = r?.updateDocument?.document ?? {};
  return { name: d.name, qboIsIgnored: d.qboIsIgnored, qboDocumentType: d.qboDocumentType };
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

/**
 * WRITE — set a vendor bill's status. Confirmed writable via updateDocument.
 * "approved" is the action behind both "Approve for payment" (Bill) and "Record
 * payment" (Expense): approving pushes the document to QuickBooks, where payment
 * is recorded (amountPaid is computed from QBO, not settable here). Allowlisted to
 * the real lifecycle values so a typo can't set a bogus status.
 */
export async function setBillStatus(
  cfg: PaveConfig,
  docId: string,
  status: "draft" | "pending" | "approved",
): Promise<string> {
  const r = await pave(cfg, {
    updateDocument: {
      $: { id: docId, status },
      document: { $: { id: docId }, id: {}, status: {} },
    },
  });
  return r?.updateDocument?.document?.status ?? status;
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
/**
 * One paginated pass over the flat job.costItems connection, with a node
 * selection wide enough to serve BOTH getJobBudget and getCostToComplete.
 * The bill page needs both — sharing the scan halves its JT calls.
 */
export async function scanJobCostItems(cfg: PaveConfig, jobId: string): Promise<any[]> {
  const nodes: any[] = [];
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
            cost: {},
            document: { id: {}, type: {}, status: {} },
            costCode: { number: {}, name: {} },
          },
        },
      },
    });
    const co = r?.job?.costItems ?? {};
    nodes.push(...(co.nodes ?? []));
    cursor = co.nextPage ?? null;
    if (!cursor) break;
  }
  return nodes;
}

export async function getJobBudget(
  cfg: PaveConfig,
  jobId: string,
  prefetched?: any[],
): Promise<BudgetItem[]> {
  const nodes = prefetched ?? (await scanJobCostItems(cfg, jobId));
  const items: BudgetItem[] = [];
  for (const n of nodes) {
    if (n?.document?.id) continue; // bill-child cost item, not a budget leaf
    if (/^uncategorized\b/i.test(String(n?.name ?? "").trim())) continue;
    const number = n?.costCode?.number?.toString().trim();
    if (!number) continue;
    items.push({ id: n.id, number, name: n?.costCode?.name ?? n?.name ?? "" });
  }
  // stable sort by code for the dropdown
  return items.sort((a, b) => a.number.localeCompare(b.number));
}

export interface CostToComplete {
  budget: number; // Σ budget-leaf cost for the code (the estimate)
  actual: number; // Σ approved+pending vendorBill cost for the code (spent/committed)
  remaining: number; // budget − actual (negative = over budget)
}

/**
 * Cost to Complete per cost code = budget − actual. JobTread has no stored CTC
 * field: budget is the sum of the code's budget-leaf cost items (document==null),
 * actual is the sum of its approved+pending vendor-bill cost items. Keyed by cost
 * code number. One paginated pass over the flat job.costItems connection.
 */
export async function getCostToComplete(
  cfg: PaveConfig,
  jobId: string,
  prefetched?: any[],
): Promise<Record<string, CostToComplete>> {
  const nodes = prefetched ?? (await scanJobCostItems(cfg, jobId));

  const budget: Record<string, number> = {};
  const actual: Record<string, number> = {};
  for (const n of nodes) {
    const code = n.costCode?.number;
    if (!code) continue;
    const c = n.cost ?? 0;
    if (!n.document) budget[code] = (budget[code] ?? 0) + c;
    else if (
      n.document.type === "vendorBill" &&
      (n.document.status === "approved" || n.document.status === "pending")
    ) {
      actual[code] = (actual[code] ?? 0) + c;
    }
  }
  const out: Record<string, CostToComplete> = {};
  for (const code of new Set([...Object.keys(budget), ...Object.keys(actual)])) {
    const b = budget[code] ?? 0;
    const a = actual[code] ?? 0;
    out[code] = { budget: b, actual: a, remaining: b - a };
  }
  return out;
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
  fields: { jobCostItemId?: string; quantity?: number; unitCost?: number; description?: string },
): Promise<{ id: string }> {
  const $: Record<string, unknown> = { id: costItemId };
  if (fields.jobCostItemId !== undefined) $.jobCostItemId = fields.jobCostItemId;
  if (fields.quantity !== undefined) $.quantity = fields.quantity;
  if (fields.unitCost !== undefined) $.unitCost = fields.unitCost;
  if (fields.description !== undefined) $.description = fields.description;
  const r = await pave(cfg, {
    updateCostItem: { $, costItem: { $: { id: costItemId }, id: {} } },
  });
  return { id: r?.updateCostItem?.costItem?.id ?? costItemId };
}

// ---------------------------------------------------------------------------
// INVOICE STAGING  (confirmed mechanism: createDocument type customerInvoice;
// the exact lineItems shape is the one remaining detail to lock)
// ---------------------------------------------------------------------------

// NOTE: no createDraftInvoice here. Building a customer invoice from unbilled
// items is a multi-call, server-side JobTread flow (create invoice → costGroup
// per bill → cost items → recalc) that also sets the bill↔invoice reference; a
// bare createDocument yields an EMPTY invoice and can't set that link, so the
// companion deep-links to JobTread's native builder instead (see stage/page.tsx).

/**
 * Uninvoiced vendor bills for a job — the individual bills a new customer invoice
 * will pull, mirroring JobTread's native invoice builder.
 *
 * Confirmed (probes + native-UI network capture, 2026-07): a vendor bill's
 * `referencedDocuments` is the per-bill "already invoiced" flag. When a customer
 * invoice pulls a bill, that bill's referencedDocuments gains a node of type
 * customerInvoice (any status). Uninvoiced = no customerInvoice reference. This is
 * how JT's builder discriminates — per bill, not per cost code.
 *
 * NOTE: referencedDocuments nested in paged documents 413s at size 100 (like
 * costItems), but works at ≤50 — we page at 25. A bare "Create invoice" also
 * pulls uninvoiced TIME entries, which aren't listed here yet.
 */
/** Sunset Builders Supply gets rolled into one staged line. Name-based match —
 *  the vendor-account id isn't on the bill selection we fetch (probe-first). */
const SUNSET_LABEL = "Sunset Builders Supply";
const isSunsetVendorName = (name: string) => /sunset/i.test(name);

export interface UninvoicedBillLine {
  key: string;
  label: string; // vendor · invoice#, or the rolled-up Sunset group
  cost: number;
  billIds: string[];
  isSunset: boolean;
}
export interface UninvoicedBills {
  customer: { id: string; name: string } | null;
  lines: UninvoicedBillLine[];
  total: number;
}

export async function getUninvoicedBills(
  cfg: PaveConfig,
  jobId: string,
  year?: number,
  month?: number,
): Promise<UninvoicedBills> {
  // When a billing month is given, only include bills/time dated in that month.
  // issueDate is standardized to the last day of the billing month, so a June
  // bill (2026-06-30) falls inside June's range.
  const inMonth = (dateStr?: string) => {
    if (!year || !month) return true;
    if (!dateStr) return false;
    const mm = String(month).padStart(2, "0");
    const first = `${year}-${mm}-01`;
    const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const d = String(dateStr).slice(0, 10);
    return d >= first && d <= last;
  };

  // Server-side month filter (issueDate range — the proven where shape) so we
  // don't page a job's entire bill history at size 25 on every request; the
  // client-side inMonth() below stays as belt and suspenders.
  const monthWhere: unknown[] = [];
  if (year && month) {
    const mm = String(month).padStart(2, "0");
    monthWhere.push(["issueDate", ">=", `${year}-${mm}-01`]);
    monthWhere.push([
      "issueDate",
      "<=",
      `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
    ]);
  }

  let bills: any[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        documents: {
          $: {
            // Invoiceable = finalized bills not yet invoiced. Both pending
            // (approved-for-payment/payable) and approved (paid) are billable to
            // the customer; draft (still coding) and denied (voided) are not.
            where: {
              and: [["type", "vendorBill"], ["status", "in", ["pending", "approved"]], ...monthWhere],
            },
            size: 25,
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: {
            id: {},
            subject: {},
            externalId: {},
            number: {},
            fromName: {},
            cost: {},
            issueDate: {},
            account: { name: {} },
            referencedDocuments: { nodes: { type: {} } },
          },
        },
      },
    });
    bills = bills.concat(r?.job?.documents?.nodes ?? []);
    page = r?.job?.documents?.nextPage || undefined;
  } while (page && ++guard < 100);

  const isInvoiced = (b: any) =>
    (b.referencedDocuments?.nodes ?? []).some((n: any) => n.type === "customerInvoice");
  const open = bills.filter((b) => !isInvoiced(b) && inMonth(b.issueDate));

  // Uninvoiced time entries — a bare invoice pulls these too, so include them so
  // the preview total matches what JobTread will actually invoice.
  let timeEntries: any[] = [];
  page = undefined;
  guard = 0;
  do {
    const r: any = await pave(cfg, {
      job: {
        $: { id: jobId },
        timeEntries: {
          $: { size: 50, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: { id: {}, cost: {}, startedAt: {}, referencedDocuments: { nodes: { type: {} } } },
        },
      },
    });
    timeEntries = timeEntries.concat(r?.job?.timeEntries?.nodes ?? []);
    page = r?.job?.timeEntries?.nextPage || undefined;
  } while (page && ++guard < 100);
  const openTime = timeEntries.filter((t) => !isInvoiced(t) && inMonth(t.startedAt));
  const timeCost = openTime.reduce((s, t) => s + (t.cost ?? 0), 0);

  const vendorOf = (b: any) => String(b.account?.name ?? b.fromName ?? "Vendor");
  const isSunset = (b: any) => isSunsetVendorName(vendorOf(b));
  const sunset = open.filter(isSunset);
  const others = open.filter((b) => !isSunset(b));

  const lines: UninvoicedBillLine[] = [];
  if (sunset.length) {
    lines.push({
      key: "sunset",
      label: `${SUNSET_LABEL} (${sunset.length} invoice${sunset.length > 1 ? "s" : ""})`,
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
  if (openTime.length) {
    lines.push({
      key: "time",
      label: `Time & labor (${openTime.length} ${openTime.length > 1 ? "entries" : "entry"})`,
      cost: timeCost,
      billIds: [],
      isSunset: false,
    });
  }
  const total = open.reduce((s, b) => s + (b.cost ?? 0), 0) + timeCost;

  const c = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, location: { account: { id: {}, name: {} } } },
  });
  const acc = c?.job?.location?.account;
  const customer = acc?.id ? { id: acc.id, name: acc.name ?? "" } : null;

  return { customer, lines, total };
}

