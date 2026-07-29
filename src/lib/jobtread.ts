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
// REFERENCE-DATA CACHE
// Jobs / vendors / org users / pay-type names change rarely but are read on
// nearly every page load. Memoize them in-process with a short TTL so a warm
// server instance serves repeat reads without re-hitting Pave. The cache key is
// caller-supplied (orgId + args) and NEVER contains the grant key, so secrets
// stay out of keys/logs. Concurrent readers share one in-flight promise, and a
// rejected fetch is evicted so the next call retries instead of caching an error.
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  value: Promise<T>;
  expires: number;
}
const _refCache = new Map<string, CacheEntry<unknown>>();

function cachedRef<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = _refCache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const entry: CacheEntry<T> = {
    expires: now + ttlMs,
    value: fetcher().catch((err) => {
      if (_refCache.get(key) === (entry as CacheEntry<unknown>)) _refCache.delete(key);
      throw err;
    }),
  };
  _refCache.set(key, entry as CacheEntry<unknown>);
  return entry.value;
}

/**
 * Drop all cached reference data. Call after a write that could change jobs,
 * vendors, or org membership so the next read reflects it immediately instead of
 * waiting out the TTL.
 */
export function clearJtRefCache(): void {
  _refCache.clear();
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
  budget: number; // Σ approved customer-order cost for the code = Budgeted Cost (contract + change orders)
  actual: number; // Σ approved+pending vendorBill cost for the code (spent/committed)
  remaining: number; // budget − actual (negative = over budget)
}

/**
 * Cost to Complete per cost code = Budgeted Cost − actual. JobTread has no stored
 * CTC field, so both sides are computed from the flat job.costItems connection:
 *
 * - budget is JobTread's "Budgeted Cost" — the sum of the code's cost items on
 *   APPROVED, includeInBudget customerOrder documents (the proposal PLUS every
 *   approved change order). This is deliberately NOT the raw budget-leaf extended
 *   cost (document==null): those leaves are the base estimate and never absorb
 *   change orders, so they understate the real budget (confirmed live 2026-07 on
 *   job "Otis Perkins Addition": leaves summed 1,003,078.68 vs 1,326,647.85 of
 *   approved customer orders). The `approved` filter also drops draft-proposal
 *   duplicates that would otherwise double-count.
 * - actual is the sum of the code's approved+pending vendor-bill cost items.
 *
 * Keyed by cost code number. One paginated pass over job.costItems.
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
          nodes: {
            cost: {},
            costCode: { number: {} },
            document: { type: {}, status: {}, includeInBudget: {} },
          },
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
    const d = n.document;
    if (!d) continue; // raw budget leaf — ignored; Budgeted Cost comes from customer orders
    if (d.type === "customerOrder" && d.status === "approved" && d.includeInBudget) {
      budget[code] = (budget[code] ?? 0) + c;
    } else if (d.type === "vendorBill" && (d.status === "approved" || d.status === "pending")) {
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
export function getJobs(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
  return cachedRef(`jobs:${cfg.orgId}:${includeClosed}`, 5 * 60_000, () =>
    _getJobsUncached(cfg, includeClosed),
  );
}
async function _getJobsUncached(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
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
export function getVendors(cfg: PaveConfig): Promise<VendorRef[]> {
  return cachedRef(`vendors:${cfg.orgId}`, 30 * 60_000, () => _getVendorsUncached(cfg));
}
async function _getVendorsUncached(cfg: PaveConfig): Promise<VendorRef[]> {
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
  membershipId?: string; // the org membership id — REQUIRED to write rates (updateMembership)
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
        membershipId: n.id ?? undefined,
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
export function getOrgUsers(cfg: PaveConfig): Promise<UserRef[]> {
  return cachedRef(`users:${cfg.orgId}`, 30 * 60_000, () => _getOrgUsersUncached(cfg));
}
async function _getOrgUsersUncached(cfg: PaveConfig): Promise<UserRef[]> {
  try {
    return await fetchMembers(cfg, true);
  } catch {
    return await fetchMembers(cfg, false);
  }
}

/** Every pay-type name configured on the org — the fallback list. */
export function getOrgTimeEntryTypeNames(cfg: PaveConfig): Promise<string[]> {
  return cachedRef(`typeNames:${cfg.orgId}`, 60 * 60_000, () =>
    _getOrgTimeEntryTypeNamesUncached(cfg),
  );
}
async function _getOrgTimeEntryTypeNamesUncached(cfg: PaveConfig): Promise<string[]> {
  const r = await pave(cfg, {
    organization: { $: { id: cfg.orgId }, id: {}, timeEntryTypeNames: {} },
  });
  return (r?.organization?.timeEntryTypeNames ?? []) as string[];
}

/** Read ONE membership's current pay types fresh (bypasses the 30-min getOrgUsers
 *  cache) — the read half of a read-modify-write rate update. */
export async function getMembershipRates(cfg: PaveConfig, membershipId: string): Promise<PayType[]> {
  const r = await pave(cfg, {
    membership: { $: { id: membershipId }, id: {}, timeEntryTypes: { name: {}, hourlyRate: {} } },
  });
  return (r?.membership?.timeEntryTypes ?? []) as PayType[];
}

/**
 * Overwrite a membership's pay types (its labor rates). CONFIRMED live 2026-07-29
 * via a reversible probe on the owner's own membership:
 *  - `timeEntryTypes` is a WHOLE-ARRAY REPLACE — any type omitted is DELETED, so
 *    callers MUST pass the COMPLETE desired set (read-modify-write), never a delta.
 *  - a timeEntryTypes-only updateMembership leaves role/isInternal untouched.
 *  - keyed by MEMBERSHIP id (not user id); the grant needs the `updateMembership`
 *    action (the org's "Sunset Invoce Automation" grant is unrestricted).
 * JobTread caps a membership at 20 pay types. Callers gate behind writesEnabled()
 * and clearJtRefCache() afterward so the roster re-reads. Returns the new set.
 */
export async function updateMembershipRates(
  cfg: PaveConfig,
  membershipId: string,
  types: PayType[],
): Promise<PayType[]> {
  const clean = types
    .map((t) => ({ name: String(t.name ?? "").trim(), hourlyRate: Number(t.hourlyRate ?? 0) }))
    .filter((t) => t.name && Number.isFinite(t.hourlyRate));
  if (clean.length > 20) {
    throw new Error(`A member can have at most 20 pay types (got ${clean.length}).`);
  }
  const r = await pave(cfg, {
    updateMembership: {
      $: { id: membershipId, timeEntryTypes: clean },
      membership: {
        $: { id: membershipId },
        id: {},
        timeEntryTypes: { name: {}, hourlyRate: {} },
      },
    },
  });
  return (r?.updateMembership?.membership?.timeEntryTypes ?? []) as PayType[];
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

/** WRITE — delete a bill line (cost item). Confirmed mutation `deleteCostItem`
 * (ascent-appscript JobTread.js), no response selection. Draft-only per callers. */
export async function deleteLine(cfg: PaveConfig, costItemId: string): Promise<void> {
  await pave(cfg, { deleteCostItem: { $: { id: costItemId } } });
}

/**
 * WRITE — combine several of a bill's lines that share a cost code into one.
 * Keeps `keepId`, sets its amount to the summed extended cost (qty 1 × the sum)
 * and its name to the concatenated line descriptions, re-points it to the shared
 * code, then deletes the rest. Draft-only (callers gate on status + writesEnabled).
 *
 * `extendedCost` is the sum of the combined lines' STORED (tax-inclusive) costs,
 * so the bill total is unchanged. Mirrors createLine's tax guard: force the
 * document to taxRate 0 first so JobTread takes the amount at face value (bill tax
 * lives in nonRecoverableTax, never a per-line rate), then re-assert to undo any
 * carve. All mutations use the confirmed updateCostItem/deleteCostItem shapes.
 */
export async function combineLines(
  cfg: PaveConfig,
  args: {
    docId: string;
    keepId: string;
    deleteIds: string[];
    name: string;
    extendedCost: number;
    jobCostItemId?: string;
    description?: string;
  },
): Promise<{ keptId: string; deleted: number }> {
  const { docId, keepId, deleteIds } = args;
  const name = (args.name || "Line item").substring(0, 250);
  const unitCost = Math.round(args.extendedCost * 100) / 100;

  // 1) taxRate 0 so JT doesn't treat the summed amount as tax-inclusive (carve it).
  try {
    await pave(cfg, {
      updateDocument: { $: { id: docId, taxRate: 0 }, document: { $: { id: docId }, id: {} } },
    });
  } catch {
    /* best-effort — the re-assert below corrects any residual carve */
  }

  // 2) Fold everything onto the kept line: qty 1 × summed cost, concatenated name.
  const $: Record<string, unknown> = { id: keepId, name, quantity: 1, unitCost, isTaxable: false };
  if (args.jobCostItemId) $.jobCostItemId = args.jobCostItemId;
  if (args.description !== undefined) $.description = args.description;
  await pave(cfg, { updateCostItem: { $, costItem: { $: { id: keepId }, id: {} } } });

  // 3) Backstop: re-assert the amount now that taxRate is 0.
  try {
    await pave(cfg, {
      updateCostItem: {
        $: { id: keepId, unitCost, quantity: 1, isTaxable: false },
        costItem: { $: { id: keepId }, id: {} },
      },
    });
  } catch {
    /* the line exists; don't fail the combine over the re-assert */
  }

  // 4) Delete the folded-in lines.
  let deleted = 0;
  for (const id of deleteIds) {
    try {
      await pave(cfg, { deleteCostItem: { $: { id } } });
      deleted++;
    } catch {
      /* keep going; report how many actually deleted */
    }
  }
  return { keptId: keepId, deleted };
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
 *  on every coded line. This is the SAME JobTread field id the Apps Script push
 *  uses; keep it in sync with CONFIG.JOBTREAD.CUSTOM_FIELDS.COST_CODES in
 *  ascent-appscript/Config.js (the two repos can't share a runtime, so this is
 *  the one place it lives on the Companion side). */
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

/**
 * Bulk idempotency lookup: of the given externalIds, which already exist as
 * documents on this vendor account? One paginated pass over the account's
 * documents, matched client-side (server-side `where` on externalId 400s) —
 * far cheaper than calling findBillByExternalId once per id. Stops early once
 * every wanted id is accounted for. Returns the SUBSET that exist. Used by the
 * Amazon import to grey-out orders already ingested before the user creates.
 */
export async function findExistingExternalIds(
  cfg: PaveConfig,
  accountId: string,
  externalIds: string[],
): Promise<string[]> {
  const want = new Set(externalIds.map((s) => s.trim()).filter(Boolean));
  if (want.size === 0) return [];
  const found = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const args: Record<string, unknown> = { size: 100 };
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
      const ext = String(n.externalId ?? "").trim();
      if (ext && want.has(ext)) found.add(ext);
    }
    cursor = docs.nextPage ?? null;
    if (!cursor || nodes.length === 0 || found.size === want.size) break;
  }
  return [...found];
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

/** One job's roster row for the month-wide Invoicing preview. `billTotal` is
 *  bills-only (finalized, uninvoiced vendor bills issued in the month); the
 *  Invoicing tab refines each card's total to include uninvoiced TIME by then
 *  fetching getUninvoicedBills per job. */
export interface MonthlyInvoiceJob {
  jobId: string;
  jobName: string;
  customerName: string;
  billTotal: number;
  billCount: number;
}

/**
 * Every job with uninvoiced (finalized) vendor bills issued in a billing month —
 * the roster of client invoices to stage for that month, in ONE org-wide paged
 * `organization.documents` query (same confirmed pattern as getAllDraftBills),
 * grouped by job. This is the Invoicing tab's default all-jobs view; each card
 * then lazy-loads its full per-bill/time breakdown via getUninvoicedBills.
 *
 * A bill already on a customer invoice carries a customerInvoice node in
 * referencedDocuments (the per-bill "already billed" flag — same one
 * getUninvoicedBills uses); those drop unless includeInvoiced. Draft bills
 * (still coding) are excluded unless includeDrafts. Paged at 25 because
 * referencedDocuments nested in paged documents 413s at larger sizes.
 */
export async function getMonthlyInvoiceJobs(
  cfg: PaveConfig,
  year: number,
  month: number,
  includeInvoiced = false,
  includeDrafts = false,
): Promise<MonthlyInvoiceJob[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const statuses = includeDrafts ? ["draft", "pending", "approved"] : ["pending", "approved"];

  const q = (nodes: Record<string, unknown>, page?: string) => ({
    organization: {
      $: { id: cfg.orgId },
      id: {},
      documents: {
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["status", "in", statuses],
              ["issueDate", ">=", first],
              ["issueDate", "<=", last],
            ],
          },
          size: 25,
          ...(page ? { page } : {}),
        },
        nextPage: {},
        nodes,
      },
    },
  });
  // Rich carries the customer (job.location.account); an unconfirmed nested field
  // won't break the roster — fall back to job id/name only (same guard as
  // getAllDraftBills). The detail fetch supplies the customer either way.
  const rich = {
    id: {}, cost: {}, status: {},
    job: { id: {}, name: {}, location: { account: { id: {}, name: {} } } },
    referencedDocuments: { nodes: { type: {} } },
  };
  const min = {
    id: {}, cost: {}, status: {},
    job: { id: {}, name: {} },
    referencedDocuments: { nodes: { type: {} } },
  };

  let bills: any[] = [];
  let page: string | undefined;
  let guard = 0;
  let sel: Record<string, unknown> = rich;
  do {
    let r: any;
    try {
      r = await pave(cfg, q(sel, page));
    } catch {
      sel = min; // downgrade once; an unconfirmed field name won't break the view
      r = await pave(cfg, q(sel, page));
    }
    bills = bills.concat(r?.organization?.documents?.nodes ?? []);
    page = r?.organization?.documents?.nextPage || undefined;
  } while (page && ++guard < 100);

  const isInvoiced = (b: any) =>
    (b.referencedDocuments?.nodes ?? []).some((n: any) => n.type === "customerInvoice");

  const byJob = new Map<string, MonthlyInvoiceJob>();
  for (const b of bills) {
    if (!includeInvoiced && isInvoiced(b)) continue;
    const job = b.job;
    if (!job?.id) continue;
    let row = byJob.get(job.id);
    if (!row) {
      byJob.set(
        job.id,
        (row = {
          jobId: job.id,
          jobName: job.name ?? "",
          customerName: job.location?.account?.name ?? "",
          billTotal: 0,
          billCount: 0,
        }),
      );
    }
    row.billTotal += b.cost ?? 0;
    row.billCount += 1;
  }

  // Sort by customer (fall back to job name), ties by amount desc.
  return Array.from(byJob.values()).sort(
    (a, b) =>
      (a.customerName || a.jobName).localeCompare(b.customerName || b.jobName, undefined, {
        sensitivity: "base",
      }) || b.billTotal - a.billTotal,
  );
}

/** A JobTread customer invoice, for linking + reconciliation. `cost` is the
 *  cost basis (JobTread guarantees it == Σ of the vendor bills the invoice
 *  pulled); `total` is priceWithTax — what the customer is actually billed. */
export interface InvoiceRef {
  id: string;
  number: string; // JT invoice #
  status: string; // draft | pending | approved (denied invoices are excluded)
  issueDate: string;
  cost: number; // cost basis
  total: number; // priceWithTax (billed amount)
  amountPaid: number;
}
export interface InvoiceReconciliation {
  // Non-denied customer invoices this month's bills/time landed on (links).
  invoices: InvoiceRef[];
  invoicedBillsCost: number; // Σ cost of the month's bills now on a live invoice
  uninvoicedBillsCost: number; // Σ cost of the month's bills on no live invoice
  uninvoicedTimeCost: number; // Σ cost of the month's uninvoiced time
  remaining: number; // uninvoicedBillsCost + uninvoicedTimeCost — still to invoice
  reconciled: boolean; // an invoice exists AND nothing is left uninvoiced
}

/**
 * Connect the Invoicing preview to the actual customer invoice(s) created in
 * JobTread for a job + billing month, and verify completeness.
 *
 * Confirmed live (2026-07, `probe-invoices*`): a customer invoice's `cost`
 * equals the sum of the vendor bills it pulled (a JT invariant, so cost-vs-bills
 * is not a useful check); the meaningful verification is whether EVERY finalized
 * bill (and uninvoiced time) for the month is on a LIVE (non-denied) invoice.
 *
 * We reconcile from the BILL side — each bill's `referencedDocuments` lists the
 * invoice(s) it sits on with their status (a tiny list, no nested pagination).
 * But JobTread's RE-ISSUE pattern complicates "live": when an invoice is denied
 * and re-issued, the bills keep pointing at the DENIED original while the new
 * (live) invoice references that denied original instead of re-referencing the
 * bills (confirmed: Bunkhouse bills → #160 denied ← #186 approved). So a bill is
 * invoiced when it references a live invoice OR a denied invoice that a live
 * invoice replaced — resolved by walking the invoice→invoice replacement chain
 * (built from each invoice's `referencedDocuments where type=customerInvoice`).
 *
 * Draft bills are intentionally excluded — they aren't invoiceable yet, so they
 * don't count against completeness.
 */
export async function getInvoiceReconciliation(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<InvoiceReconciliation> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const inMonth = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = String(dateStr).slice(0, 10);
    return d >= first && d <= last;
  };
  // The customerInvoice ids a bill/time entry references (any status).
  const invRefIds = (node: any): string[] =>
    (node.referencedDocuments?.nodes ?? [])
      .filter((n: any) => n.type === "customerInvoice" && n.id)
      .map((n: any) => n.id as string);

  // 1. Finalized vendor bills for the month, each with the invoice ids it's on.
  //    Paged at 25 — referencedDocuments nested in paged documents 413s larger.
  const monthBills: { cost: number; invIds: string[] }[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r: any = await pave(cfg, {
      job: {
        $: { id: jobId },
        documents: {
          $: {
            where: { and: [["type", "vendorBill"], ["status", "in", ["pending", "approved"]]] },
            size: 25,
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: {
            id: {},
            cost: {},
            issueDate: {},
            referencedDocuments: { nodes: { id: {}, type: {}, status: {} } },
          },
        },
      },
    });
    for (const b of (r?.job?.documents?.nodes ?? []) as any[]) {
      if (inMonth(b.issueDate)) monthBills.push({ cost: b.cost ?? 0, invIds: invRefIds(b) });
    }
    page = r?.job?.documents?.nextPage || undefined;
  } while (page && ++guard < 100);

  // 2. Time for the month (a bare invoice pulls uninvoiced time too).
  const monthTime: { cost: number; invIds: string[] }[] = [];
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
            referencedDocuments: { nodes: { id: {}, type: {}, status: {} } },
          },
        },
      },
    });
    for (const t of (r?.job?.timeEntries?.nodes ?? []) as any[]) {
      if (inMonth(t.startedAt)) monthTime.push({ cost: t.cost ?? 0, invIds: invRefIds(t) });
    }
    page = r?.job?.timeEntries?.nextPage || undefined;
  } while (page && ++guard < 100);

  // 3. ALL the job's customer invoices (any status) + the predecessor invoice(s)
  //    each one replaced (referencedDocuments filtered server-side to invoices,
  //    so we never page a big invoice's bill refs).
  const byId = new Map<string, any>();
  const replacedBy = new Map<string, any[]>(); // predecessor id -> invoices that replaced it
  page = undefined;
  guard = 0;
  do {
    const r: any = await pave(cfg, {
      job: {
        $: { id: jobId },
        documents: {
          $: { where: { and: [["type", "customerInvoice"]] }, size: 25, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            issueDate: {},
            status: {},
            cost: {},
            priceWithTax: {},
            amountPaid: {},
            referencedDocuments: {
              $: { where: { and: [["type", "customerInvoice"]] }, size: 25 },
              nodes: { id: {} },
            },
          },
        },
      },
    });
    for (const iv of (r?.job?.documents?.nodes ?? []) as any[]) {
      byId.set(iv.id, iv);
      for (const p of (iv.referencedDocuments?.nodes ?? []) as any[]) {
        if (!p.id) continue;
        let arr = replacedBy.get(p.id);
        if (!arr) replacedBy.set(p.id, (arr = []));
        arr.push(iv);
      }
    }
    page = r?.job?.documents?.nextPage || undefined;
  } while (page && ++guard < 100);

  // Resolve a referenced invoice id to the LIVE (non-denied) invoice covering it,
  // following the replacement chain (bill -> denied original -> live re-issue).
  const resolveLive = (startId: string): any | null => {
    const seen = new Set<string>();
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const iv = byId.get(id);
      if (iv && iv.status !== "denied") return iv;
      for (const rep of replacedBy.get(id) ?? []) queue.push(rep.id);
    }
    return null;
  };
  const liveInvoiceFor = (invIds: string[]): any | null => {
    for (const id of invIds) {
      const live = resolveLive(id);
      if (live) return live;
    }
    return null;
  };

  // 4. Partition the month's bills/time into invoiced (on a live invoice, directly
  //    or via a re-issue) vs still uninvoiced, and collect the live invoices hit.
  const linkedIds = new Set<string>();
  let invoicedBillsCost = 0;
  let uninvoicedBillsCost = 0;
  for (const b of monthBills) {
    const live = liveInvoiceFor(b.invIds);
    if (live) {
      invoicedBillsCost += b.cost;
      linkedIds.add(live.id);
    } else {
      uninvoicedBillsCost += b.cost;
    }
  }
  let uninvoicedTimeCost = 0;
  for (const t of monthTime) {
    const live = liveInvoiceFor(t.invIds);
    if (live) linkedIds.add(live.id);
    else uninvoicedTimeCost += t.cost;
  }

  const invoices: InvoiceRef[] = [...linkedIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((i) => ({
      id: i.id,
      number: i.number != null ? String(i.number) : "",
      status: i.status ?? "",
      issueDate: i.issueDate ?? "",
      cost: i.cost ?? 0,
      total: i.priceWithTax ?? 0,
      amountPaid: i.amountPaid ?? 0,
    }))
    .sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    );

  const remaining = Math.round((uninvoicedBillsCost + uninvoicedTimeCost) * 100) / 100;
  return {
    invoices,
    invoicedBillsCost,
    uninvoicedBillsCost,
    uninvoicedTimeCost,
    remaining,
    reconciled: invoices.length > 0 && Math.abs(remaining) < 0.01,
  };
}

// ---------------------------------------------------------------------------
// TIME ENTRIES — createTimeEntry / updateTimeEntry / deleteTimeEntry / a
// per-user read, all confirmed LIVE 2026-07-23 via probeTimeEntryClockInOut()
// (ascent-appscript EmployeeTime.js): an OPEN entry (startedAt only, no
// endedAt), updateTimeEntry to set endedAt later (the clock-out),
// deleteTimeEntry (cancel/cleanup), and user.timeEntries for the "my time"
// list — each verified by actually creating, updating, and deleting a
// [PROBE]-tagged entry against live JobTread.
// ---------------------------------------------------------------------------

/**
 * TIMESTAMPS ARE TRUE UTC INSTANTS — confirmed live 2026-07-24 by creating,
 * reading back, and deleting three probe entries:
 *
 *   sent "2026-07-24T09:00:00"       → stored "2026-07-24T09:00:00.000Z"
 *   sent "2026-07-24T09:00:00-07:00" → stored "2026-07-24T16:00:00.000Z"
 *   sent "2026-07-24T16:00:00Z"      → stored "2026-07-24T16:00:00.000Z"
 *
 * A zoneless string is read as UTC, never as local time, and JobTread's UI then
 * renders the instant in the org's timezone. Handing it a bare wall clock made
 * every entry land 7 hours early (a 9:00 AM entry displayed as 2:00 AM PDT), so
 * ALWAYS convert local↔UTC at this boundary with the two helpers below.
 *
 * JobTread's CSV IMPORTER does the opposite — it reads a zoneless stamp as
 * ORG-local (an 08:00 import row is stored as 15:00Z). That's why /labor-import
 * deliberately emits offset-free stamps, and why it must stay that way: the
 * importer and this API disagree, so don't "unify" them.
 */
export const JT_ORG_TZ = "America/Los_Angeles";

/** How far ahead of UTC `tz` is at `instant` (negative west of UTC), in ms. */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // That zone's wall clock read as-if-UTC, minus the real instant, IS the offset.
  return (
    Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - instant
  );
}

/**
 * A local wall clock ("YYYY-MM-DDTHH:MM[:SS]", no zone) → the UTC instant it
 * names in `tz`, as the ISO string JobTread should store. "" if unparseable.
 */
export function orgLocalToJtIso(local: string, tz: string = JT_ORG_TZ): string {
  const m = (local ?? "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Two passes: the second resolves the offset against the real instant, so a
  // time on a DST-shift day isn't converted with the previous day's offset.
  const instant = naive - tzOffsetMs(naive - tzOffsetMs(naive, tz), tz);
  return new Date(instant).toISOString();
}

/**
 * The inverse — a JobTread timestamp → the "YYYY-MM-DDTHH:MM:SS" wall clock it
 * reads as in `tz`, i.e. exactly what JobTread's own UI shows. "" if unparseable.
 */
export function jtIsoToOrgLocal(iso: string, tz: string = JT_ORG_TZ): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  return new Date(t + tzOffsetMs(t, tz)).toISOString().slice(0, 19);
}

export interface CreateTimeEntryArgs {
  userId: string; // JobTread user id (the member's `user.id`)
  jobId: string;
  costItemId: string; // the job's budget-leaf jobCostItemId (JT requires a cost item)
  startedAt: string; // UTC instant ISO, e.g. "2026-07-22T21:30:00.000Z" — build it with orgLocalToJtIso()
  endedAt?: string; // same shape; OMIT for an OPEN/running entry (clock-in). JT derives minutes.
  type: string; // pay-type NAME (a rate; per worker × job) — REQUIRED (JT 400s without it).
  notes: string;
  isApproved?: boolean; // default false → office reviews before it counts
}

// JobTread's cost codes carry no queryable "time-trackable" field (7 candidate
// field names on costCode all rejected in the probe) — it only tells you at
// write time. Rephrase that specific 400 into something a field employee can
// act on, instead of the raw API sentence.
function rewriteTimeEntryError(message: string): string {
  if (/cost type that is not able to be time tracked/i.test(message)) {
    return "This cost code doesn't support time tracking in JobTread — pick a different one.";
  }
  return message;
}

/**
 * WRITE — create a JobTread time entry. Omit `endedAt` for an OPEN/running
 * entry (clock-in); JobTread leaves it null until a later updateTimeEntry
 * (clock-out) sets it. Coordinates are deliberately NOT sent — that optional
 * field's shape is unverified, and the GPS is recorded in our own Time
 * Entries log instead.
 */
export async function createTimeEntry(
  cfg: PaveConfig,
  args: CreateTimeEntryArgs,
): Promise<{ id: string }> {
  const $: Record<string, unknown> = {
    organizationId: cfg.orgId,
    userId: args.userId,
    jobId: args.jobId,
    costItemId: args.costItemId,
    type: args.type,
    startedAt: args.startedAt,
    notes: args.notes ?? "",
    isApproved: args.isApproved ?? false,
  };
  if (args.endedAt) $.endedAt = args.endedAt;

  try {
    const r = await pave(cfg, {
      createTimeEntry: { $, createdTimeEntry: { id: {} } },
    });
    const id = r?.createTimeEntry?.createdTimeEntry?.id;
    if (!id) throw new Error("createTimeEntry returned no time entry id.");
    return { id };
  } catch (e) {
    throw new Error(rewriteTimeEntryError(e instanceof Error ? e.message : "Unknown error"));
  }
}

/**
 * WRITE — the clock-out half: set `endedAt` (and/or revise notes) on an open
 * entry. The return selection needs its OWN `$: {id}` (confirmed — matches
 * updateDocument/updateCostItem's shape), not just the mutation's top-level $.
 */
export async function updateTimeEntry(
  cfg: PaveConfig,
  id: string,
  fields: { endedAt?: string; notes?: string },
): Promise<{ id: string; endedAt?: string }> {
  const $: Record<string, unknown> = { id };
  if (fields.endedAt !== undefined) $.endedAt = fields.endedAt;
  if (fields.notes !== undefined) $.notes = fields.notes;
  try {
    const r = await pave(cfg, {
      updateTimeEntry: { $, timeEntry: { $: { id }, id: {}, endedAt: {} } },
    });
    const t = r?.updateTimeEntry?.timeEntry;
    return { id: t?.id ?? id, endedAt: t?.endedAt };
  } catch (e) {
    throw new Error(rewriteTimeEntryError(e instanceof Error ? e.message : "Unknown error"));
  }
}

/**
 * WRITE — delete a time entry (cancel a mistaken clock-in). Confirmed live:
 * no return-selection object is needed, just the id argument.
 */
export async function deleteTimeEntry(cfg: PaveConfig, id: string): Promise<void> {
  await pave(cfg, { deleteTimeEntry: { $: { id } } });
}

export interface UserTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  notes: string;
  jobId: string;
  jobName: string;
  costCode: string;
  costItemName: string;
}

/**
 * READ — one user's time entries, every job. Confirmed live: `user.timeEntries`
 * returns the full field set (job, costItem/costCode, notes) and paginates via
 * `nextPage` like every other connection in this API.
 *
 * `user.timeEntries` DOES support a server-side `where` on `startedAt` and a
 * `sortBy` (confirmed live 2026-07-28 via probeTimeEntryWhereFilter in
 * ascent-appscript Diagnostics.js: `where {and:[["startedAt",">=",…],
 * ["startedAt","<",…]]}` and `sortBy:[{field:"startedAt",order:"desc"}]` both
 * apply correctly, and the filtered set matches a client-side filter of the
 * full pull — an earlier note here that no date filter existed was wrong).
 * Pass `opts.sinceIso`/`opts.untilIso` to bound the fetch (huge win for the
 * bi-monthly "My Time" view, which otherwise pages a worker's whole history to
 * keep ~15 days) and `opts.sortDesc` for newest-first. With no opts it fetches
 * every entry as before — the leave-accrual path relies on that. JobTread's own
 * ordering isn't guaranteed, so callers should still sort by startedAt.
 */
export async function getUserTimeEntries(
  cfg: PaveConfig,
  userId: string,
  opts: { sinceIso?: string; untilIso?: string; sortDesc?: boolean; maxPages?: number } = {},
): Promise<UserTimeEntry[]> {
  const maxPages = opts.maxPages ?? 20;
  const out: UserTimeEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const range: unknown[] = [];
    if (opts.sinceIso) range.push(["startedAt", ">=", opts.sinceIso]);
    if (opts.untilIso) range.push(["startedAt", "<", opts.untilIso]);
    if (range.length) args.where = range.length === 1 ? range[0] : { and: range };
    if (opts.sortDesc) args.sortBy = [{ field: "startedAt", order: "desc" }];
    const r = await pave(cfg, {
      user: {
        $: { id: userId },
        id: {},
        timeEntries: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            startedAt: {},
            endedAt: {},
            notes: {},
            job: { id: {}, name: {} },
            costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
          },
        },
      },
    });
    const tc = r?.user?.timeEntries ?? {};
    for (const n of tc.nodes ?? []) {
      out.push({
        id: n.id,
        startedAt: n.startedAt,
        endedAt: n.endedAt ?? null,
        notes: n.notes ?? "",
        jobId: n.job?.id ?? "",
        jobName: n.job?.name ?? "",
        costCode: n.costItem?.costCode?.number ?? "",
        costItemName: n.costItem?.costCode?.name || n.costItem?.name || "",
      });
    }
    cursor = tc.nextPage ?? null;
    if (!cursor) break;
  }
  return out;
}

