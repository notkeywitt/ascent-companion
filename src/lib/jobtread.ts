/**
 * JobTread Pave API client — the verified calls behind the assistant tool.
 *
 * Every query/mutation here was confirmed live against the Pave API in July 2026
 * (see ascent-appscript/CLAUDE.md "Assistant-tool findings" and the `_invp*`
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
  cost?: number; // pre-tax line subtotal
  nonRecoverableTax?: number; // recorded sales tax (document-level, "Tax")
  issueDate?: string;
  jobId?: string; // the bill's job (populated only by the org-wide query)
  jobName?: string;
  saved?: boolean; // Assistant-side flag: Save has been clicked on this bill
  reviewed?: boolean; // Assistant-side flag: bill explicitly marked reviewed
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
    id: {}, name: {}, subject: {}, fromName: {}, number: {}, externalId: {}, status: {}, cost: {}, nonRecoverableTax: {}, issueDate: {},
  };
  const min = { id: {}, name: {}, status: {}, cost: {}, nonRecoverableTax: {}, issueDate: {} };
  let r: any;
  try {
    r = await pave(cfg, q(rich));
  } catch {
    r = await pave(cfg, q(min)); // an unconfirmed field name won't break the queue
  }
  return r?.job?.documents?.nodes ?? [];
}

/**
 * Draft vendor bills across EVERY job — the coding queue when no job is picked.
 * Uses the org-wide documents connection (confirmed live 2026-07: each node
 * carries `job { id, name }`); pages via the nextPage cursor. Each bill is
 * tagged with its own jobId/jobName so the queue can link straight into that
 * job's bill view.
 */
export async function getAllDraftBills(cfg: PaveConfig): Promise<DraftBill[]> {
  const q = (nodes: Record<string, unknown>, page?: string) => ({
    organization: {
      $: { id: cfg.orgId },
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
    id: {}, name: {}, subject: {}, fromName: {}, number: {}, externalId: {}, status: {}, cost: {}, nonRecoverableTax: {}, issueDate: {},
    job: { id: {}, name: {} },
  };
  const min = { id: {}, name: {}, status: {}, cost: {}, nonRecoverableTax: {}, issueDate: {}, job: { id: {}, name: {} } };
  const flatten = (nodes: any[]): DraftBill[] =>
    nodes.map((n) => ({ ...n, jobId: n?.job?.id, jobName: n?.job?.name }));

  const out: DraftBill[] = [];
  let page: string | undefined;
  let guard = 0;
  let sel = rich;
  do {
    let r: any;
    try {
      r = await pave(cfg, q(sel, page));
    } catch {
      sel = min as any; // an unconfirmed field name won't break the queue
      r = await pave(cfg, q(sel, page));
    }
    out.push(...flatten(r?.organization?.documents?.nodes ?? []));
    page = r?.organization?.documents?.nextPage || undefined;
  } while (page && ++guard < 100);
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
    nonRecoverableTax?: number; // recorded sales tax (document-level, "Tax")
    nonRecoverableTaxName?: string;
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
      qboIsIgnored: {}, nonRecoverableTax: {}, nonRecoverableTaxName: {},
      ...lineSel,
    },
  };
  const min = {
    document: {
      $: { id: docId },
      id: {}, name: {}, status: {}, cost: {}, issueDate: {}, nonRecoverableTax: {},
      ...lineSel,
    },
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
      qboIsIgnored: d.qboIsIgnored,
      nonRecoverableTax: d.nonRecoverableTax,
      nonRecoverableTaxName: d.nonRecoverableTaxName,
    },
    lines: d.costItems?.nodes ?? [],
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

/**
 * Org-wide count of draft vendor bills (the Coding Review queue, across every
 * job) — a single aggregate query, confirmed live via organization.documents'
 * `count` field (2026-07): { where: [type=vendorBill,status=draft], count: {} }.
 * Used for a lightweight cross-tab "bills waiting" flag; never throws.
 */
export async function getDraftVendorBillCount(cfg: PaveConfig): Promise<number | null> {
  try {
    const r = await pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        id: {},
        documents: {
          $: { where: { and: [["type", "vendorBill"], ["status", "draft"]] } },
          count: {},
        },
      },
    });
    const count = r?.organization?.documents?.count;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
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
): Promise<Record<string, CostToComplete>> {
  let nodes: any[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: { cost: {}, costCode: { number: {} }, document: { type: {}, status: {} } },
        },
      },
    });
    nodes = nodes.concat(r?.job?.costItems?.nodes ?? []);
    page = r?.job?.costItems?.nextPage || undefined;
  } while (page && ++guard < 50);

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
  address?: string; // job.location.formattedAddress (Google-normalized)
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
            location: { account: { name: {} }, formattedAddress: {} },
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
        address: n.location?.formattedAddress ?? "",
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
/** A time-entry pay type available to one member (its `name` is the `type` field). */
export interface PayType {
  name: string;
  hourlyRate?: number;
}

export interface UserRef {
  id: string;
  name: string; // JobTread's DISPLAY name — what its importer matches on
  isInternal: boolean;
  types?: PayType[]; // undefined when the grant can't read per-member types
}

async function fetchMembers(cfg: PaveConfig, withTypes: boolean): Promise<UserRef[]> {
  const out: UserRef[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const nodes: Record<string, unknown> = {
      id: {},
      isInternal: {},
      user: { id: {}, name: {} },
    };
    // Array of { name, hourlyRate } — the sub-fields must be selected explicitly;
    // an empty {} returns the objects with no fields (name comes back undefined).
    if (withTypes) nodes.timeEntryTypes = { name: {}, hourlyRate: {} };
    const r = await pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        id: {},
        memberships: { $: args, nextPage: {}, nodes },
      },
    });
    const mc = r?.organization?.memberships ?? {};
    for (const n of mc.nodes ?? []) {
      const u = n?.user;
      if (!u?.id) continue;
      out.push({
        id: u.id,
        name: u.name ?? "",
        isInternal: !!n.isInternal,
        types: withTypes ? ((n.timeEntryTypes ?? []) as PayType[]) : undefined,
      });
    }
    cursor = mc.nextPage ?? null;
    if (!cursor) break;
  }
  // Internal staff first (the people who log labor), then alphabetical.
  return out.sort(
    (a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name),
  );
}

/**
 * Org members (JobTread users), for the labor importer's worker mapping.
 *
 * `user.name` is the display name JobTread matches on. It's usually just a first
 * name ("Cedar", "Tommy", "Casey") but NOT always — "Ty O'Steen" is the full
 * name — so it must be read from JT, never synthesised from the QB first name.
 * `user` exposes no email, so name/id are the only handles.
 *
 * `timeEntryTypes` is each member's OWN set of pay types (the time entry `type`
 * field). Reading it requires the `createTimeEntryForMembership` action on the
 * grant; if the grant lacks it the whole query 403s, so we retry without it and
 * callers fall back to the org-wide type list.
 */
export async function getOrgUsers(cfg: PaveConfig): Promise<UserRef[]> {
  try {
    return await fetchMembers(cfg, true);
  } catch {
    return await fetchMembers(cfg, false);
  }
}

/** Every pay-type name configured on the org — the fallback list. */
export async function getOrgTimeEntryTypeNames(cfg: PaveConfig): Promise<string[]> {
  const r = await pave(cfg, {
    organization: { $: { id: cfg.orgId }, id: {}, timeEntryTypeNames: {} },
  });
  return (r?.organization?.timeEntryTypeNames ?? []) as string[];
}

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

/**
 * Add a new line (cost item) to an existing bill. Uses the confirmed
 * `createCostItem` mutation with `documentId` (same fields as createVendorBill's
 * lineItems — proven in the production Apps Script push). jobCostItemId is
 * optional: omit it and the line lands uncoded. Tax stays at the document level
 * (nonRecoverableTax), so new lines are non-taxable like every other bill line.
 *
 * TAX-CARVE GUARD (confirmed live 2026-07-18): if the target bill carries a
 * non-zero document `taxRate` (bills NOT created by the Assistant can — e.g. an
 * old empty JobTread bill), JobTread treats the entered amount as tax-INCLUSIVE
 * and divides it (e.g. 79.99 → cost 73.23 + tax 6.76), so the amount is wrong.
 * We defend the way createVendorBill does — force the document to `taxRate: 0`
 * first (tax on a bill lives in nonRecoverableTax, never a per-line rate) — and,
 * as a backstop, re-assert the exact amount with the confirmed updateCostItem
 * once the rate is 0 so any residual carve is corrected. Both extra writes are
 * best-effort: never fail the add over them.
 */
export async function createLine(
  cfg: PaveConfig,
  docId: string,
  fields: {
    name: string;
    jobCostItemId?: string;
    quantity?: number;
    unitCost?: number;
    description?: string;
  },
): Promise<{ id: string }> {
  const quantity = fields.quantity ?? 1;
  const unitCost = fields.unitCost ?? 0;

  // 1) Force taxRate 0 so JT takes the amount at face value (not tax-inclusive).
  try {
    await pave(cfg, {
      updateDocument: { $: { id: docId, taxRate: 0 }, document: { $: { id: docId }, id: {} } },
    });
  } catch {
    /* best-effort — the re-assert below corrects any carve that slips through */
  }

  const $: Record<string, unknown> = {
    documentId: docId,
    name: (fields.name || "Line item").substring(0, 250),
    quantity,
    unitCost,
    isTaxable: false,
  };
  if (fields.jobCostItemId) $.jobCostItemId = fields.jobCostItemId;
  if (fields.description !== undefined) $.description = fields.description;
  const r = await pave(cfg, {
    createCostItem: { $, createdCostItem: { id: {} } },
  });
  const id = r?.createCostItem?.createdCostItem?.id;
  if (!id) throw new Error("createCostItem returned no cost item id.");

  // 2) Backstop: with the document now at taxRate 0, re-assert the amount so a
  //    tax-inclusive carve from the insert lands back at the entered value.
  try {
    await pave(cfg, {
      updateCostItem: {
        $: { id, unitCost, quantity, isTaxable: false },
        costItem: { $: { id }, id: {} },
      },
    });
  } catch {
    /* the line exists; don't fail the add over the re-assert */
  }

  return { id };
}

// ---------------------------------------------------------------------------
// INVOICE STAGING  (confirmed mechanism: createDocument type customerInvoice;
// the exact lineItems shape is the one remaining detail to lock)
// ---------------------------------------------------------------------------

// NOTE: no createDraftInvoice here. Building a customer invoice from unbilled
// items is a multi-call, server-side JobTread flow (create invoice → costGroup
// per bill → cost items → recalc) that also sets the bill↔invoice reference; a
// bare createDocument yields an EMPTY invoice and can't set that link, so the
// assistant deep-links to JobTread's native builder instead (see stage/page.tsx).

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
    lines.push({
      key: b.id,
      label: vendorOf(b),
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
 * pulls uninvoiced TIME entries — the "time" line's `timeEntries` carries
 * employee/hours/rate detail for each one.
 */
/** A CSI cost code + the amount coded to it (the breakdown behind one bill or the
 *  code on one time entry). `code` is costCode.number — usually a CSI number, but
 *  can be a bare label (e.g. "Office Admin"); `name` is costCode.name. */
export interface CsiAmount {
  code: string;
  name: string;
  amount: number;
}
export interface UninvoicedBillRef {
  id: string; // JT document id — links to the assistant bill view + JT doc page
  label: string; // invoice # / externalId (or vendor)
  cost: number;
  invoiced: boolean; // already on a customer invoice (only appears when includeInvoiced)
  status?: string; // JT document status: pending (approved for payment) | approved (paid)
  csi?: CsiAmount[]; // this bill's cost items aggregated per CSI code (amount desc)
}
export interface UninvoicedTimeEntryRef {
  id: string;
  employee: string;
  hours: number;
  rate: number;
  cost: number; // the entry's coded cost (hours × rate, JT-authoritative)
  code?: string; // costItem.costCode.number
  codeName?: string; // costItem.costCode.name
}
export interface UninvoicedBillLine {
  key: string;
  label: string; // vendor · invoice#, or the rolled-up Sunset group
  cost: number;
  billIds: string[];
  isSunset: boolean;
  // Individual documents behind this line. A single-vendor line carries one;
  // the Sunset group carries every Sunset bill so the UI can list them under
  // the group total. Empty/undefined for non-document lines (e.g. Time & labor).
  bills?: UninvoicedBillRef[];
  // Individual time entries behind the Time & labor line (employee/hours/rate
  // detail only — no per-entry cost, the group row above already has the total).
  timeEntries?: UninvoicedTimeEntryRef[];
}
export interface UninvoicedBills {
  customer: { id: string; name: string } | null;
  job?: { id: string; name: string };
  lines: UninvoicedBillLine[];
  total: number;
}

// ---------------------------------------------------------------------------
// BILL INGESTION  (roadmap D — the Gemini engine's JobTread write path, ported
// from the PROVEN Apps Script pushExpenditureToJobTread / attachPdfToJobTread-
// Document / findExistingBillByExternalId. Field-for-field parity with the
// production payloads; do not add unverified fields here — probe first.)
// ---------------------------------------------------------------------------

/** Cost-item custom field "Cost Codes" (text) — the raw CSI the engine writes
 *  on every coded line (same id the Apps Script push uses). */
export const CF_COST_CODES = "22PYwxRXb8yr";

export interface NewBillLine {
  name: string; // line description (JT caps at ~255; callers pre-truncate to 250)
  description?: string; // the raw CSI code, mirroring the Apps Script convention
  unitCost: number;
  quantity: number;
  isTaxable: boolean;
  jobCostItemId?: string; // budget coding target; omit = lands uncoded in the queue
  costCode?: string; // raw CSI → written to the Cost Codes custom field
}

export interface CreateVendorBillArgs {
  jobId: string;
  accountId: string; // JT vendor account
  vendorName: string; // fromName
  subject: string;
  externalId: string; // idempotency key (the assistant's INV-xxxxxxxx)
  issueDate: string; // yyyy-MM-dd
  dueDate?: string | null; // yyyy-MM-dd; when null, dueDays applies
  dueDays?: number | null;
  taxAmount: number; // document-level sales tax → nonRecoverableTax
  jobLocationName?: string;
  jobLocationAddress?: string;
  pushToQuickBooks?: boolean; // default true (qboIsIgnored = !push)
  lines: NewBillLine[];
}

/**
 * WRITE — create a draft vendor bill (createDocument type:vendorBill). No
 * `status` arg: newly created bills land as DRAFT (the coding queue), exactly
 * like the production Apps Script push. Tax rides in nonRecoverableTax with
 * lines non-taxable (or taxable lines with 0 when the document shows no tax) —
 * see computeLineTaxability in billing.ts.
 */
export async function createVendorBill(
  cfg: PaveConfig,
  args: CreateVendorBillArgs,
): Promise<{ id: string }> {
  const lineItems = args.lines.map((l) => {
    const li: Record<string, unknown> = {
      _type: "costItem",
      name: l.name.substring(0, 250),
      description: l.description ?? "",
      unitCost: l.unitCost,
      quantity: l.quantity,
      isTaxable: l.isTaxable,
    };
    if (l.jobCostItemId) li.jobCostItemId = l.jobCostItemId;
    if (l.costCode) {
      li.customFieldValues = [{ customFieldId: CF_COST_CODES, value: l.costCode }];
    }
    return li;
  });

  const docArgs: Record<string, unknown> = {
    type: "vendorBill",
    jobId: args.jobId,
    accountId: args.accountId,
    name: "Bill",
    subject: args.subject,
    externalId: args.externalId,
    issueDate: args.issueDate,
    fromName: args.vendorName,
    toName: "Ascent Building Co",
    taxRate: 0,
    nonRecoverableTaxName: "Tax",
    nonRecoverableTax: args.taxAmount,
    lineItems,
    includeInBudget: true,
    qboIsIgnored: !(args.pushToQuickBooks ?? true),
    qboIsBillable: true,
  };
  if (args.jobLocationName) docArgs.jobLocationName = args.jobLocationName;
  if (args.jobLocationAddress) docArgs.jobLocationAddress = args.jobLocationAddress;
  if (args.dueDate) docArgs.dueDate = args.dueDate;
  else docArgs.dueDays = args.dueDays ?? 30;

  const r = await pave(cfg, {
    createDocument: {
      $: docArgs,
      createdDocument: { id: {} },
    },
  });
  const id = r?.createDocument?.createdDocument?.id;
  if (!id) throw new Error("createDocument returned no document id.");
  return { id };
}

/**
 * Idempotency check (port of findExistingBillByExternalId): does the vendor
 * account already have a document with this externalId? Pages the account's
 * documents and matches client-side — server-side `where` on externalId 400s.
 * Returns the existing doc id, null when absent, or throws on API failure so
 * the caller can refuse to create (fail CLOSED, never duplicate).
 */
export async function findBillByExternalId(
  cfg: PaveConfig,
  accountId: string,
  externalId: string,
): Promise<string | null> {
  const target = externalId.trim();
  if (!target) return null;
  let cursor: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const args: Record<string, unknown> = { size: 50 };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      account: {
        $: { id: accountId },
        documents: { $: args, nextPage: {}, nodes: { id: {}, externalId: {} } },
      },
    });
    const docs = r?.account?.documents ?? {};
    const nodes: any[] = docs.nodes ?? [];
    for (const n of nodes) {
      if (String(n.externalId ?? "").trim() === target) return n.id;
    }
    cursor = docs.nextPage ?? null;
    if (!cursor || nodes.length === 0) break;
  }
  return null;
}

/** A job's name + location address, for the bill header fields. */
export async function getJobHeaderInfo(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ name: string; address: string }> {
  const r = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, name: {}, location: { address: {} } },
  });
  return {
    name: r?.job?.name ?? "",
    address: r?.job?.location?.address ?? "",
  };
}

/**
 * WRITE — attach an uploaded file to a document via the confirmed three-step
 * GCS flow: createUploadRequest (requires organizationId or the file lands in
 * the wrong bucket) → presigned PUT → createFile targetType:document.
 */
export async function attachFileToDocument(
  cfg: PaveConfig,
  docId: string,
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ id: string }> {
  // Step 1: createUploadRequest
  const r1 = await pave(cfg, {
    createUploadRequest: {
      $: { type: mimeType, size: bytes.length, organizationId: cfg.orgId },
      createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} },
    },
  });
  const up = r1?.createUploadRequest?.createdUploadRequest;
  if (!up?.url || !up?.id) throw new Error("createUploadRequest returned no upload URL.");

  // Step 2: PUT the bytes to GCS
  const put = await fetch(up.url, {
    method: up.method || "PUT",
    headers: up.headers || {},
    body: new Uint8Array(bytes),
  });
  if (put.status !== 200 && put.status !== 204) {
    throw new Error(`File PUT failed with HTTP ${put.status}`);
  }

  // Step 3: createFile against the document
  const r3 = await pave(cfg, {
    createFile: {
      $: { uploadRequestId: up.id, targetId: docId, targetType: "document", name: fileName },
      createdFile: { id: {}, name: {} },
    },
  });
  const fileId = r3?.createFile?.createdFile?.id;
  if (!fileId) throw new Error("createFile returned no file id.");
  return { id: fileId };
}

export async function getUninvoicedBills(
  cfg: PaveConfig,
  jobId: string,
  year?: number,
  month?: number,
  includeInvoiced = false,
  includeDrafts = false,
): Promise<UninvoicedBills> {
  // When a billing month is given, only include bills/time dated in that month.
  // issueDate is standardized to the last day of the billing month, so a June
  // bill (2026-06-30) falls inside June's range. Omit year/month to span all
  // months (the "filter by billing month" toggle off).
  const inMonth = (dateStr?: string) => {
    if (!year || !month) return true;
    if (!dateStr) return false;
    const mm = String(month).padStart(2, "0");
    const first = `${year}-${mm}-01`;
    const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const d = String(dateStr).slice(0, 10);
    return d >= first && d <= last;
  };

  // Invoiceable = finalized bills not yet invoiced. Both pending
  // (approved-for-payment/payable) and approved (paid) are billable to the
  // customer; denied (voided) never is. Draft (still coding) is excluded by
  // default, but includeDrafts adds it so the office can preview a month that
  // isn't fully coded yet (draft bills carry a "Draft" badge in the UI).
  const statuses = includeDrafts ? ["draft", "pending", "approved"] : ["pending", "approved"];

  let bills: any[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        documents: {
          $: {
            where: { and: [["type", "vendorBill"], ["status", "in", statuses]] },
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
            status: {},
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
  // includeInvoiced relaxes the uninvoiced filter (shows bills already on a
  // customer invoice too); the invoiced flag lets the UI mark them.
  const open = bills.filter((b) => (includeInvoiced || !isInvoiced(b)) && inMonth(b.issueDate));

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
          nodes: {
            id: {},
            cost: {},
            startedAt: {},
            minutes: {},
            hourlyRate: {},
            user: { name: {} },
            costItem: { costCode: { number: {}, name: {} } },
            referencedDocuments: { nodes: { type: {} } },
          },
        },
      },
    });
    timeEntries = timeEntries.concat(r?.job?.timeEntries?.nodes ?? []);
    page = r?.job?.timeEntries?.nextPage || undefined;
  } while (page && ++guard < 100);
  const openTime = timeEntries.filter(
    (t) => (includeInvoiced || !isInvoiced(t)) && inMonth(t.startedAt),
  );
  const timeCost = openTime.reduce((s, t) => s + (t.cost ?? 0), 0);

  // Per-bill CSI breakdown. costItems nested inside paged documents 413s, so
  // fetch the job's FLAT costItems connection instead — it still returns each
  // bill's child cost items, every one carrying its document link (same two-phase
  // pattern as the budget mapper). Server-side `document` filtering 400s, so join
  // client-side by document id and aggregate the amounts per CSI cost code.
  const openIds = new Set(open.map((b) => b.id));
  const csiByBill = new Map<string, Map<string, { name: string; amount: number }>>();
  page = undefined;
  guard = 0;
  do {
    const r: any = await pave(cfg, {
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: { cost: {}, costCode: { number: {}, name: {} }, document: { id: {}, type: {} } },
        },
      },
    });
    for (const n of (r?.job?.costItems?.nodes ?? []) as any[]) {
      const doc = n.document;
      if (!doc || doc.type !== "vendorBill" || !openIds.has(doc.id)) continue;
      const code = String(n.costCode?.number ?? "").trim();
      if (!code) continue;
      let byCode = csiByBill.get(doc.id);
      if (!byCode) csiByBill.set(doc.id, (byCode = new Map()));
      const prev = byCode.get(code);
      byCode.set(code, {
        name: n.costCode?.name ?? prev?.name ?? "",
        amount: (prev?.amount ?? 0) + (n.cost ?? 0),
      });
    }
    page = r?.job?.costItems?.nextPage || undefined;
  } while (page && ++guard < 50);

  const csiOf = (billId: string): CsiAmount[] =>
    Array.from(csiByBill.get(billId)?.entries() ?? [])
      .map(([code, v]) => ({ code, name: v.name, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);

  const vendorOf = (b: any) => String(b.account?.name ?? b.fromName ?? "Vendor");
  const isSunset = (b: any) => /sunset/i.test(vendorOf(b));
  const sunset = open.filter(isSunset);
  const others = open.filter((b) => !isSunset(b));

  // Per-bill invoice label: externalId (Sunset invoice #) → #number → id.
  const invLabel = (b: any) => b.externalId || (b.number ? `#${b.number}` : b.id);

  // Display order: non-Sunset invoices alphabetically by vendor (ties by cost
  // desc), then the Time & labor group, then the Sunset group ALWAYS LAST.
  const byLabelThenCost = (a: UninvoicedBillLine, b: UninvoicedBillLine) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || b.cost - a.cost;

  const lines: UninvoicedBillLine[] = [];
  for (const b of others) {
    lines.push({
      key: b.id,
      label: vendorOf(b),
      cost: b.cost ?? 0,
      billIds: [b.id],
      isSunset: false,
      bills: [
        {
          id: b.id,
          label: invLabel(b),
          cost: b.cost ?? 0,
          invoiced: isInvoiced(b),
          status: b.status,
          csi: csiOf(b.id),
        },
      ],
    });
  }
  lines.sort(byLabelThenCost);
  if (openTime.length) {
    const timeEntryDetails = openTime
      .slice()
      // Cluster by employee (then chronologically within each employee).
      .sort(
        (a, b) =>
          String(a.user?.name ?? "").localeCompare(String(b.user?.name ?? ""), undefined, {
            sensitivity: "base",
          }) || String(a.startedAt).localeCompare(String(b.startedAt)),
      )
      .map((t) => ({
        id: t.id,
        employee: t.user?.name ?? "Unknown",
        hours: (t.minutes ?? 0) / 60,
        rate: t.hourlyRate ?? 0,
        cost: t.cost ?? 0,
        code: t.costItem?.costCode?.number ?? undefined,
        codeName: t.costItem?.costCode?.name ?? undefined,
      }));
    lines.push({
      key: "time",
      label: `Time & labor (${openTime.length} ${openTime.length > 1 ? "entries" : "entry"})`,
      cost: timeCost,
      billIds: [],
      isSunset: false,
      timeEntries: timeEntryDetails,
    });
  }
  if (sunset.length) {
    lines.push({
      key: "sunset",
      label: `Sunset Builders Supply (${sunset.length} invoice${sunset.length > 1 ? "s" : ""})`,
      cost: sunset.reduce((s, b) => s + (b.cost ?? 0), 0),
      billIds: sunset.map((b) => b.id),
      isSunset: true,
      bills: sunset
        .map((b) => ({
          id: b.id,
          label: invLabel(b),
          cost: b.cost ?? 0,
          invoiced: isInvoiced(b),
          status: b.status,
          csi: csiOf(b.id),
        }))
        .sort((a, b) => b.cost - a.cost),
    });
  }
  const total = open.reduce((s, b) => s + (b.cost ?? 0), 0) + timeCost;

  const c = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, name: {}, location: { account: { id: {}, name: {} } } },
  });
  const acc = c?.job?.location?.account;
  const customer = acc?.id ? { id: acc.id, name: acc.name ?? "" } : null;
  const job = { id: jobId, name: c?.job?.name ?? "" };

  return { customer, job, lines, total };
}

