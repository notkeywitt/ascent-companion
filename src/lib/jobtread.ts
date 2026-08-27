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

import { findMutations } from "@/lib/paveGateway";

const PAVE_URL = "https://api.jobtread.com/pave";

/** Per-request timeout. A single Pave page (size ≤ 100) is fast; this only
 *  bounds a hung socket, and sits well under the shortest route budget. */
const PAVE_TIMEOUT_MS = 30_000;

/** Transport statuses where the request never produced a result, so a repeat is
 *  safe and worth trying. A 200 carrying a JSON `errors` array is a QUERY error,
 *  not transient — it is never retried (repeating a bad query just fails again). */
const PAVE_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const PAVE_MAX_ATTEMPTS = 3;
/** Backoff before attempts 2 and 3. Short because this blocks a live request
 *  under a route's function budget, unlike the appscript batch loop it mirrors. */
const PAVE_BACKOFF_MS = [500, 1500];

const paveSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PaveConfig {
  grantKey: string; // JT_GRANT_KEY
  orgId: string; // JT_ORG_ID, e.g. "22PXG7QcMaQ2"
  companyName?: string; // issuer name for customer invoices (fromName)
}

/** Low-level Pave call. `query` is the Pave query object (grantKey injected here). */
export async function pave<T = any>(cfg: PaveConfig, query: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ query: { $: { grantKey: cfg.grantKey }, ...query } });

  // A mutation must NEVER be retried: re-sending create/update/delete after a
  // transient failure risks a duplicate write (a second bill, line, or payment).
  // Reads are safe to repeat, so only they get the backoff loop. Same detector
  // the /api/pave gateway uses, so "what is a write" has a single definition —
  // and it inspects only root fields, so selecting createdAt/updatedAt on a read
  // doesn't make it look like a write.
  const mayRetry = findMutations(query).length === 0;
  const maxAttempts = mayRetry ? PAVE_MAX_ATTEMPTS : 1;

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    let text: string;
    try {
      res = await fetch(PAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(PAVE_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      // Network failure or the per-request timeout — transient. Retry a read;
      // surface it immediately for a mutation (we can't know if it landed).
      const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error";
      lastErr = new Error(`Pave request ${why}`);
      if (mayRetry && attempt < maxAttempts) {
        await paveSleep(PAVE_BACKOFF_MS[attempt - 1] ?? 1500);
        continue;
      }
      throw lastErr;
    }

    // Transient transport status: the request didn't produce a result. Retry a
    // read, else throw. (A mutation with maxAttempts=1 falls straight through.)
    if (PAVE_RETRY_STATUS.has(res.status)) {
      lastErr = new Error(`Pave error (HTTP ${res.status}): ${text ? text.slice(0, 300) : "transient"}`);
      if (mayRetry && attempt < maxAttempts) {
        await paveSleep(PAVE_BACKOFF_MS[attempt - 1] ?? 1500);
        continue;
      }
      throw lastErr;
    }

    // JobTread returns plain text for some errors (e.g. a bad grant key ->
    // "Supplied key is invalid"), so parse defensively rather than assume JSON.
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
      // A query/auth error or a non-JSON 200 — NOT transient, so never retried.
      throw new Error(`Pave error (HTTP ${res.status}): ${msg}`);
    }
    return json as T;
  }

  // Unreachable in practice — the loop returns or throws — but satisfies the
  // type checker and covers a hypothetical zero-attempt configuration.
  throw lastErr ?? new Error("Pave error: request could not be completed");
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

/**
 * Per-job cost data (budget leaves + cost-to-complete) is cached under these keys.
 * Short TTL: unlike jobs/vendors, this moves whenever a bill is approved or the
 * budget is edited in JobTread, and the bill view renders CTC numbers from it. Long
 * enough to make stepping through a job's coding queue cheap (every bill on a job
 * reads the same two things), short enough that a JobTread-side edit shows up on its
 * own within a minute.
 */
const JOB_COST_TTL_MS = 60_000;
const _jobCostKey = (kind: string, orgId: string, jobId: string) => `${kind}:${orgId}:${jobId}`;

/**
 * Drop every cached budget/CTC entry. Call after any write that changes what those
 * queries return — approving a bill (it starts counting toward actual), re-coding a
 * non-draft line, adding/removing/combining lines, moving a bill to another job — so
 * the bill view can't show a stale Remaining column for up to a minute afterward.
 *
 * Deliberately not job-scoped: the bill write routes are given a docId, not a jobId,
 * and resolving one to the other would cost an extra JobTread round trip on every
 * write. Clearing all of them instead costs at most one re-read (~300 ms) on the next
 * bill opened for some *other* job, which is strictly cheaper than that.
 */
export function clearJobCostCaches(): void {
  for (const key of _refCache.keys()) {
    if (
      key.startsWith("budget:") ||
      key.startsWith("ctc:") ||
      key.startsWith("costdetail:") ||
      key.startsWith("contributors:")
    ) {
      _refCache.delete(key);
    }
  }
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
  files: BillFile[]; // attached invoice PDF/image — same document, same round trip
}

/**
 * A bill's header + lines (with current coding) + attached files. Rich header falls
 * back to minimal. `files` rides along in the SAME document query (confirmed live
 * 2026-08-03: a single `document` read serves costItems and files together, the 413
 * two-phase rule applies only to costItems nested in a *paged* documents connection),
 * so the bill view costs one round trip here instead of two.
 */
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
    files: { $: { size: 20 }, nodes: { id: {}, name: {}, type: {}, url: {} } },
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
    files: d.files?.nodes ?? [],
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
 * WRITE — set a bill's Vendor Bill Number (JobTread's `externalId`, the vendor's
 * invoice/bill number). Capped at JobTread's 32-char limit; an empty string clears
 * it. Never touches lineItems (updateDocument with lineItems wipes cost items —
 * CLAUDE.md). Note this is also the ingestion dedup key, but that only matters at
 * create time — editing an existing bill's number here is safe.
 */
export async function setBillExternalId(
  cfg: PaveConfig,
  docId: string,
  externalId: string,
): Promise<string> {
  const value = String(externalId ?? "").slice(0, 32);
  const r = await pave(cfg, {
    updateDocument: {
      $: { id: docId, externalId: value },
      document: { $: { id: docId }, id: {}, externalId: {} },
    },
  });
  return r?.updateDocument?.document?.externalId ?? value;
}

/**
 * WRITE — set a bill's document-level sales tax. This is JobTread's "Tax" field:
 * `nonRecoverableTax` (a DOLLAR amount) with `nonRecoverableTaxName` "Tax" — the
 * same field/name the Apps Script push uses (JobTread.js). Confirmed live 2026-07-29
 * that JobTread stores line costs at face value (unitCost × quantity) and keeps this
 * tax SEPARATE and ON TOP (total = Σ line cost + nonRecoverableTax), so setting it
 * never changes the line amounts or the subtotal. Setting it as a dollar amount (not
 * a per-document `taxRate` %) also avoids JobTread's tax-carve on line writes
 * (see [[jt-createcostitem-tax-carve]]). Never touches lineItems (updateDocument with
 * lineItems wipes cost items — CLAUDE.md).
 */
export async function setBillTax(
  cfg: PaveConfig,
  docId: string,
  taxAmount: number,
): Promise<number> {
  const amount = Math.round((Number(taxAmount) || 0) * 100) / 100;
  const r = await pave(cfg, {
    updateDocument: {
      $: { id: docId, nonRecoverableTax: amount, nonRecoverableTaxName: "Tax" },
      document: { $: { id: docId }, id: {}, nonRecoverableTax: {} },
    },
  });
  return r?.updateDocument?.document?.nonRecoverableTax ?? amount;
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
  name: string; // the COST CODE's name — shared by every row under that code
  /**
   * This row's OWN name ("Wood Decking - Labor", "Permits and Fees"). An estimate
   * routinely splits one cost code into several rows, and `name` above is identical
   * across all of them, so this and `costType` are what tell those rows apart.
   */
  detail?: string;
  /** Labor / Materials / Subcontractor / Other. */
  costType?: string;
  /** This row's estimated amount — 0 marks a placeholder row nobody budgeted. */
  cost?: number;
  /**
   * JobTread's own division name for this code (`costCode.parentCostCode`), so a
   * budget rail can group codes the way JobTread does instead of printing a bare
   * "Division 06". Absent when the code has no parent.
   */
  division?: string;
}

/**
 * The job's budget leaves (coding targets), for the cost-code dropdown. Mirrors
 * the Apps Script budget mapper: skip bill-child items (those carry a document id)
 * and JobTread's auto "Uncategorized <code>" rollups.
 *
 * The document-child filter runs SERVER-side (`where: [["document","id"], null]`),
 * so JobTread returns only the budget leaves instead of every cost item on the job.
 * Confirmed live 2026-08-03 on the three biggest jobs — identical leaf sets to the
 * old full walk, in one page instead of 7–13 (Otis Perkins: 1,209 items scanned →
 * 86 returned, 1,425 ms → 101 ms). Falls back to the unfiltered walk if the filter
 * ever 400s, so the dropdown can't go empty.
 *
 * Cached per job (see JOB_COST_TTL_MS) — stepping through a job's coding queue asks
 * for the same dropdown on every bill.
 */
export function getJobBudget(cfg: PaveConfig, jobId: string): Promise<BudgetItem[]> {
  return cachedRef(_jobCostKey("budget", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getJobBudgetUncached(cfg, jobId),
  );
}
async function _getJobBudgetUncached(cfg: PaveConfig, jobId: string): Promise<BudgetItem[]> {
  const walk = async (where?: unknown): Promise<BudgetItem[]> => {
    const items: BudgetItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const args: Record<string, unknown> = { size: 100 };
      if (where) args.where = where;
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
              document: { id: {} },
              costCode: { number: {}, name: {}, parentCostCode: { name: {} } },
              costType: { name: {} },
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
        items.push({
          id: n.id,
          number,
          name: n?.costCode?.name ?? n?.name ?? "",
          detail: n?.name ?? "",
          costType: n?.costType?.name ?? "",
          cost: typeof n?.cost === "number" ? n.cost : undefined,
          division: n?.costCode?.parentCostCode?.name ?? undefined,
        });
      }
      cursor = co.nextPage ?? null;
      if (!cursor) break;
    }
    return items;
  };
  let items: BudgetItem[];
  try {
    items = await walk([["document", "id"], null]);
  } catch {
    items = await walk(); // filter rejected — fall back to scanning every cost item
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
 * Keyed by cost code number.
 *
 * Both sides are summed BY JOBTREAD, server-side: each is one grouped-aggregate
 * query (`where` narrows to the documents that count, `group.by` = cost code,
 * `aggs.total` = sum of cost) rather than a full paginated scan of job.costItems
 * summed here. Confirmed live 2026-08-03 against the old full-walk numbers on the
 * three biggest jobs — penny-identical per code, in 2 calls instead of 7–13
 * (Otis Perkins: 1,408 ms → 321 ms). Falls back to the old walk if either
 * aggregate ever 400s, so the CTC column can't silently go blank.
 */
const CTC_BUDGET_WHERE = {
  and: [
    [["document", "type"], "customerOrder"],
    [["document", "status"], "approved"],
    [["document", "includeInBudget"], true],
  ],
};
const CTC_ACTUAL_WHERE = {
  and: [
    [["document", "type"], "vendorBill"],
    { in: [{ field: ["document", "status"] }, [{ value: "approved" }, { value: "pending" }]] },
  ],
};

/** Σ cost per cost-code number over the cost items matching `where`, summed by JobTread. */
async function _sumCostByCostCode(
  cfg: PaveConfig,
  jobId: string,
  where: unknown,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: {
            size: 100, // pages over GROUPS (one per cost code), not raw cost items
            where,
            group: { by: [["costCode", "number"]], aggs: { total: { sum: "cost" } } },
            ...(page ? { page } : {}),
          },
          withValues: {},
          nextPage: {},
        },
      },
    });
    for (const row of r?.job?.costItems?.withValues ?? []) {
      const code = row?.costCode?.number?.toString().trim();
      if (!code) continue;
      out[code] = (out[code] ?? 0) + (row.total ?? 0);
    }
    page = r?.job?.costItems?.nextPage || undefined;
  } while (page && ++guard < 20);
  return out;
}

/**
 * The pre-2026-08 way: one full paginated scan of job.costItems, bucketed here.
 * Kept only as the safety net for `getCostToComplete` — same arithmetic, same
 * result, just 7–13 round trips instead of 2.
 */
async function _costToCompleteByFullWalk(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ budget: Record<string, number>; actual: Record<string, number> }> {
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
  return { budget, actual };
}

export function getCostToComplete(
  cfg: PaveConfig,
  jobId: string,
): Promise<Record<string, CostToComplete>> {
  return cachedRef(_jobCostKey("ctc", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getCostToCompleteUncached(cfg, jobId),
  );
}
async function _getCostToCompleteUncached(
  cfg: PaveConfig,
  jobId: string,
): Promise<Record<string, CostToComplete>> {
  let budget: Record<string, number>;
  let actual: Record<string, number>;
  try {
    [budget, actual] = await Promise.all([
      _sumCostByCostCode(cfg, jobId, CTC_BUDGET_WHERE),
      _sumCostByCostCode(cfg, jobId, CTC_ACTUAL_WHERE),
    ]);
  } catch {
    ({ budget, actual } = await _costToCompleteByFullWalk(cfg, jobId));
  }
  const out: Record<string, CostToComplete> = {};
  for (const code of new Set([...Object.keys(budget), ...Object.keys(actual)])) {
    const b = budget[code] ?? 0;
    const a = actual[code] ?? 0;
    out[code] = { budget: b, actual: a, remaining: b - a };
  }
  return out;
}

// ---------------------------------------------------------------------------
// JOB COST DETAIL  — the three-level tree behind the /jobs browser
// ---------------------------------------------------------------------------

/** One estimate line (level 3) — the Tracking Sheet's row granularity. */
export interface CostLine {
  id: string;
  name: string; // the line's OWN name, e.g. "Wood Decking - Labor"
  description?: string;
  quantity?: number;
  unit?: string; // unit.name, e.g. "sf" / "month"
  unitCost?: number;
  cost: number; // extended cost = the sheet's TOTAL
  costType?: string; // Labor / Materials / Subcontractor / Other
  isAllowance: boolean; // allowanceType is set on this line
}

/** Estimate money split by the Tracking Sheet's cost-type columns. */
export interface CostTypeSplit {
  labor: number; // ALLOWANCE/SUB/VENDOR's sibling — costType "Labor"
  allowance: number; // any line with an allowanceType
  sub: number; // costType "Subcontractor"
  vendor: number; // costType "Materials"
  other: number; // anything else, so the split always sums to budget
}

/** One cost code (level 2). */
export interface CostCodeRow {
  number: string;
  name: string; // the COST CODE's name
  division: string; // first two digits
  budget: number; // Σ approved customer-order line cost for this code
  bills: number; // Σ approved+pending vendor-bill cost
  labor: number; // Σ time-entry cost, every entry regardless of approval
  laborHours: number; // Σ time-entry minutes ÷ 60, every entry
  laborApproved: number; // Σ time-entry cost, isApproved entries only
  laborApprovedHours: number; // …of which, in hours
  invoiced: number; // Σ approved customer-invoice line cost, all time
  currentInvoice: number; // …of which the most recent invoice
  split: CostTypeSplit;
  lines: CostLine[];
}

/** One CSI division (level 1). */
export interface CostDivisionRow {
  division: string; // "01", "06", … ("—" when a code has no digits)
  name: string; // JobTread's parent cost-code name
  budget: number;
  bills: number;
  labor: number;
  laborHours: number;
  laborApproved: number;
  laborApprovedHours: number;
  invoiced: number;
  currentInvoice: number;
  split: CostTypeSplit;
  codes: CostCodeRow[];
}

/**
 * Which number the `budget` fields hold.
 * - `customerOrders` — JobTread's "Budgeted Cost": approved, includeInBudget
 *   customerOrder lines, so it absorbs approved change orders. The default.
 * - `budgetLeaves` — the base estimate (cost items with no document), used only
 *   when a job has no approved customer orders at all.
 */
export type BudgetBasis = "customerOrders" | "budgetLeaves";

export interface JobCostDetail {
  divisions: CostDivisionRow[];
  budgetBasis: BudgetBasis;
  budgetTotal: number;
  billsTotal: number;
  laborTotal: number;
  laborHoursTotal: number;
  invoicedTotal: number;
  currentInvoiceTotal: number;
  /** Name/date of the invoice behind `currentInvoice`, for the column header. */
  currentInvoiceLabel: string | null;
  /** Names of any query that fell back to the slow path, for the UI to surface. */
  degraded: string[];
}

const emptySplit = (): CostTypeSplit => ({
  labor: 0,
  allowance: 0,
  sub: 0,
  vendor: 0,
  other: 0,
});

/** Which cost-type column a line lands in. Allowance wins — it is a line flag, not a type. */
function splitKeyFor(costType: string | undefined, isAllowance: boolean): keyof CostTypeSplit {
  if (isAllowance) return "allowance";
  switch ((costType ?? "").trim().toLowerCase()) {
    case "labor":
      return "labor";
    case "subcontractor":
      return "sub";
    case "materials":
      return "vendor";
    default:
      return "other";
  }
}

const addSplit = (into: CostTypeSplit, from: CostTypeSplit) => {
  into.labor += from.labor;
  into.allowance += from.allowance;
  into.sub += from.sub;
  into.vendor += from.vendor;
  into.other += from.other;
};

/**
 * Σ time-entry cost and minutes per cost-code number, summed BY JOBTREAD.
 * `where` narrows the entries counted (e.g. `["isApproved", true]`, confirmed
 * live 2026-08-06) — omit it for every entry regardless of approval.
 *
 * Same grouped-aggregate shape as `_sumCostByCostCode` (`timeEntries` is a
 * standard connection, so it takes `group`/`withValues`), which replaces the
 * browser's old full pagination of job.timeEntries. Rate is deliberately NOT
 * summed — an average of `hourlyRate` across entries is wrong when rates differ;
 * the UI derives it as cost ÷ hours.
 */
async function _sumTimeByCostCode(
  cfg: PaveConfig,
  jobId: string,
  where?: unknown,
): Promise<Record<string, { cost: number; minutes: number }>> {
  const out: Record<string, { cost: number; minutes: number }> = {};
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        id: {},
        timeEntries: {
          $: {
            size: 100, // pages over GROUPS (one per cost code), not raw entries
            ...(where ? { where } : {}),
            group: {
              by: [["costItem", "costCode", "number"]],
              aggs: { total: { sum: "cost" }, mins: { sum: "minutes" } },
            },
            ...(page ? { page } : {}),
          },
          withValues: {},
          nextPage: {},
        },
      },
    });
    for (const row of r?.job?.timeEntries?.withValues ?? []) {
      const code = row?.costItem?.costCode?.number?.toString().trim();
      if (!code) continue;
      const e = (out[code] ??= { cost: 0, minutes: 0 });
      e.cost += row.total ?? 0;
      e.minutes += row.mins ?? 0;
    }
    page = r?.job?.timeEntries?.nextPage || undefined;
  } while (page && ++guard < 20);
  return out;
}

/**
 * The pre-aggregate way: page every time entry and bucket here. Safety net
 * only. `approvedOnly` filters client-side (this walk has the raw nodes
 * already, so no second query is needed the way the aggregate path needs one).
 */
async function _sumTimeByFullWalk(
  cfg: PaveConfig,
  jobId: string,
  approvedOnly = false,
): Promise<Record<string, { cost: number; minutes: number }>> {
  const out: Record<string, { cost: number; minutes: number }> = {};
  let page: string | undefined;
  let guard = 0;
  do {
    const r = await pave(cfg, {
      job: {
        $: { id: jobId },
        timeEntries: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: {
            cost: {},
            minutes: {},
            isApproved: {},
            costItem: { costCode: { number: {} } },
          },
        },
      },
    });
    for (const n of r?.job?.timeEntries?.nodes ?? []) {
      if (approvedOnly && !n?.isApproved) continue;
      const code = n?.costItem?.costCode?.number?.toString().trim();
      if (!code) continue;
      const e = (out[code] ??= { cost: 0, minutes: 0 });
      e.cost += n.cost ?? 0;
      e.minutes += n.minutes ?? 0;
    }
    page = r?.job?.timeEntries?.nextPage || undefined;
  } while (page && ++guard < 20);
  return out;
}

/**
 * The estimate lines behind the budget, with everything the Tracking-Sheet-style
 * table needs per line (quantity / unit / unit cost / cost type / allowance).
 *
 * `where` is applied SERVER-side, so JobTread returns only the lines that count
 * instead of every cost item on the job — the same trick that took
 * `_getJobBudgetUncached` from 1,209 scanned items to 86 returned. Confirmed
 * live 2026-08-04: on Otis Perkins the filtered query returns 115 lines in 2
 * pages / 654 ms against 1,220 items in 13 pages / 2,017 ms for the full walk,
 * with identical totals ($1,326,647.85).
 */
async function _costItemLines(cfg: PaveConfig, jobId: string, where: unknown): Promise<any[]> {
  const nodes: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (where) args.where = where;
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
            description: {},
            quantity: {},
            unitCost: {},
            cost: {},
            unit: { name: {} },
            costType: { name: {} },
            allowanceType: {},
            document: { type: {}, status: {}, includeInBudget: {} },
            costCode: { number: {}, name: {}, parentCostCode: { number: {}, name: {} } },
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

/**
 * Approved customer invoices on a job, newest issueDate first.
 *
 * Confirmed live 2026-08-04 across 5 jobs (Bunkhouse, Beach Shack, Otis Perkins,
 * Pole Barn, Car Barn): these invoices ARE fully CSI-coded — the sum of their
 * cost items matches the document-level `cost` to the penny, with nothing
 * uncoded (e.g. Otis Perkins, 235 lines over 43 cost codes, Δ = 0.00). That is
 * what makes the invoiced-per-cost-code columns safe to compute.
 */
const INVOICED_WHERE = {
  and: [
    [["document", "type"], "customerInvoice"],
    [["document", "status"], "approved"],
  ],
};

async function _approvedCustomerInvoices(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ id: string; name: string; issueDate: string | null; cost: number }[]> {
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      documents: {
        $: {
          size: 100,
          where: { and: [["type", "customerInvoice"], ["status", "approved"]] },
        },
        nodes: { id: {}, name: {}, issueDate: {}, cost: {} },
      },
    },
  });
  const nodes: any[] = r?.job?.documents?.nodes ?? [];
  return nodes
    .map((n) => ({
      id: n.id,
      name: String(n.name ?? ""),
      issueDate: n.issueDate ?? null,
      cost: n.cost ?? 0,
    }))
    .sort((a, b) => String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")));
}

/**
 * Everything the /jobs browser needs for one job, as a division → cost code →
 * estimate line tree, in ~6 JobTread calls instead of the browser's old 13–33.
 *
 * Cached per job at JOB_COST_TTL_MS and dropped by `clearJobCostCaches()`, so a
 * bill write shows up immediately rather than waiting out the TTL.
 */
export function getJobCostDetail(cfg: PaveConfig, jobId: string): Promise<JobCostDetail> {
  return cachedRef(_jobCostKey("costdetail", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getJobCostDetailUncached(cfg, jobId),
  );
}
async function _getJobCostDetailUncached(cfg: PaveConfig, jobId: string): Promise<JobCostDetail> {
  const degraded: string[] = [];

  // 1. Budget side — approved customer-order lines, i.e. JobTread's own
  //    "Budgeted Cost" (server-filtered, with a client-filtered full walk as the
  //    safety net so the table can't go empty).
  let lineNodes: any[];
  try {
    lineNodes = await _costItemLines(cfg, jobId, CTC_BUDGET_WHERE);
  } catch {
    degraded.push("budget");
    const all = await _costItemLines(cfg, jobId, undefined);
    lineNodes = all.filter(
      (n) =>
        n?.document?.type === "customerOrder" &&
        n?.document?.status === "approved" &&
        n?.document?.includeInBudget,
    );
  }

  // Not every job's budget was issued as an approved customer order — measured
  // 2026-08-04, 8 of the org's 24 jobs have real budget leaves but no approved
  // customerOrder at all (Pole Barn: $319,530 of leaves, $0 of orders, against
  // $306,945 of bills). On those, the customer-order basis alone would render a
  // $0 budget and a six-figure red "over budget", so fall back to the base
  // estimate and tell the UI which basis it got rather than showing a number
  // that looks like a disaster.
  let budgetBasis: BudgetBasis = "customerOrders";
  if (lineNodes.reduce((s, n) => s + (n?.cost ?? 0), 0) === 0) {
    try {
      const leaves = await _costItemLines(cfg, jobId, [["document", "id"], null]);
      if (leaves.some((n) => (n?.cost ?? 0) !== 0)) {
        lineNodes = leaves;
        budgetBasis = "budgetLeaves";
      }
    } catch {
      degraded.push("budget fallback");
    }
  }

  // 2. Actual spend per cost code — approved + pending vendor bills. Reuses the
  //    exact predicate and aggregate the bill view's Remaining column runs on.
  let bills: Record<string, number>;
  try {
    bills = await _sumCostByCostCode(cfg, jobId, CTC_ACTUAL_WHERE);
  } catch {
    degraded.push("bills");
    ({ actual: bills } = await _costToCompleteByFullWalk(cfg, jobId));
  }

  // 3. Labor per cost code — time entries carry their own cost, so bills and
  //    labor never double-count. Fetched twice: every entry, and isApproved
  //    entries only — the Invoicing board's "include unapproved time" toggle
  //    switches between them with no extra round trip.
  let time: Record<string, { cost: number; minutes: number }>;
  let timeApproved: Record<string, { cost: number; minutes: number }>;
  try {
    [time, timeApproved] = await Promise.all([
      _sumTimeByCostCode(cfg, jobId),
      _sumTimeByCostCode(cfg, jobId, ["isApproved", true]),
    ]);
  } catch {
    degraded.push("labor");
    time = await _sumTimeByFullWalk(cfg, jobId);
    timeApproved = await _sumTimeByFullWalk(cfg, jobId, true);
  }

  // 4. Invoiced per cost code — approved customer-invoice lines, all time, plus
  //    the most recent invoice on its own so the view can separate CURRENT
  //    INVOICE from TOTAL PREVIOUSLY INVOICED the way the Tracking Sheet does.
  //    "Current" is the latest invoice by issueDate rather than a calendar
  //    window, so it can't drift from deriveBillingPeriod()'s 10th-to-10th rule.
  let invoiced: Record<string, number> = {};
  let currentInvoice: Record<string, number> = {};
  let currentInvoiceLabel: string | null = null;
  try {
    const invoices = await _approvedCustomerInvoices(cfg, jobId);
    if (invoices.length > 0) {
      invoiced = await _sumCostByCostCode(cfg, jobId, INVOICED_WHERE);
      const latest = invoices[0];
      currentInvoice = await _sumCostByCostCode(cfg, jobId, [["document", "id"], latest.id]);
      currentInvoiceLabel = latest.issueDate
        ? `${latest.name} · ${latest.issueDate}`
        : latest.name || null;
    }
  } catch {
    degraded.push("invoiced");
    invoiced = {};
    currentInvoice = {};
    currentInvoiceLabel = null;
  }

  // ---- fold into the tree ------------------------------------------------
  const codes = new Map<string, CostCodeRow>();
  const divisionNames = new Map<string, string>();

  const codeRow = (
    number: string,
    name: string,
    parentName?: string,
    parentNumber?: string,
  ): CostCodeRow => {
    const digits = number.replace(/\D/g, "");
    const division = digits ? digits.slice(0, 2) : "—";
    if (parentName && !divisionNames.get(division)) divisionNames.set(division, parentName);
    else if (parentNumber && !divisionNames.get(division)) divisionNames.set(division, parentNumber);
    let row = codes.get(number);
    if (!row) {
      row = {
        number,
        name,
        division,
        budget: 0,
        bills: 0,
        labor: 0,
        laborHours: 0,
        laborApproved: 0,
        laborApprovedHours: 0,
        invoiced: 0,
        currentInvoice: 0,
        split: emptySplit(),
        lines: [],
      };
      codes.set(number, row);
    }
    if (!row.name && name) row.name = name;
    return row;
  };

  for (const n of lineNodes) {
    const number = n?.costCode?.number?.toString().trim();
    if (!number) continue;
    if (/^uncategorized\b/i.test(String(n?.name ?? "").trim())) continue;
    const row = codeRow(
      number,
      n?.costCode?.name ?? "",
      n?.costCode?.parentCostCode?.name,
      n?.costCode?.parentCostCode?.number,
    );
    const cost = typeof n?.cost === "number" ? n.cost : 0;
    const isAllowance = n?.allowanceType != null;
    const costType = n?.costType?.name ?? undefined;
    row.budget += cost;
    row.split[splitKeyFor(costType, isAllowance)] += cost;
    row.lines.push({
      id: n.id,
      name: String(n?.name ?? "").trim(),
      description: n?.description ?? undefined,
      quantity: typeof n?.quantity === "number" ? n.quantity : undefined,
      unit: n?.unit?.name ?? undefined,
      unitCost: typeof n?.unitCost === "number" ? n.unitCost : undefined,
      cost,
      costType,
      isAllowance,
    });
  }

  // Actuals can land on a code that has no budget line (coded to something never
  // estimated) — those must still appear, or the totals won't tie out.
  for (const [number, amount] of Object.entries(bills)) {
    codeRow(number, "").bills += amount;
  }
  for (const [number, t] of Object.entries(time)) {
    const row = codeRow(number, "");
    row.labor += t.cost;
    row.laborHours += t.minutes / 60;
  }
  for (const [number, t] of Object.entries(timeApproved)) {
    const row = codeRow(number, "");
    row.laborApproved += t.cost;
    row.laborApprovedHours += t.minutes / 60;
  }
  for (const [number, amount] of Object.entries(invoiced)) {
    codeRow(number, "").invoiced += amount;
  }
  for (const [number, amount] of Object.entries(currentInvoice)) {
    codeRow(number, "").currentInvoice += amount;
  }

  const divisions = new Map<string, CostDivisionRow>();
  for (const row of codes.values()) {
    row.lines.sort((a, b) => a.name.localeCompare(b.name));
    let d = divisions.get(row.division);
    if (!d) {
      d = {
        division: row.division,
        name: divisionNames.get(row.division) ?? (row.division === "—" ? "Uncategorized" : ""),
        budget: 0,
        bills: 0,
        labor: 0,
        laborHours: 0,
        laborApproved: 0,
        laborApprovedHours: 0,
        invoiced: 0,
        currentInvoice: 0,
        split: emptySplit(),
        codes: [],
      };
      divisions.set(row.division, d);
    }
    d.budget += row.budget;
    d.bills += row.bills;
    d.labor += row.labor;
    d.laborHours += row.laborHours;
    d.laborApproved += row.laborApproved;
    d.laborApprovedHours += row.laborApprovedHours;
    d.invoiced += row.invoiced;
    d.currentInvoice += row.currentInvoice;
    addSplit(d.split, row.split);
    d.codes.push(row);
  }

  const out = [...divisions.values()].sort((a, b) => a.division.localeCompare(b.division));
  for (const d of out) d.codes.sort((a, b) => a.number.localeCompare(b.number));

  return {
    divisions: out,
    budgetBasis,
    budgetTotal: out.reduce((s, d) => s + d.budget, 0),
    billsTotal: out.reduce((s, d) => s + d.bills, 0),
    laborTotal: out.reduce((s, d) => s + d.labor, 0),
    laborHoursTotal: out.reduce((s, d) => s + d.laborHours, 0),
    invoicedTotal: out.reduce((s, d) => s + d.invoiced, 0),
    currentInvoiceTotal: out.reduce((s, d) => s + d.currentInvoice, 0),
    currentInvoiceLabel,
    degraded,
  };
}

/** One vendor-bill line behind a cost code's "bills" total in getJobCostDetail. */
export interface CostCodeBillContributor {
  id: string; // costItemId — matches JobBillLine.id, so a staged (unsynced) recode can be reconciled
  docId: string;
  code: string; // costCode.number, so the client groups without a second fetch
  vendor: string;
  label: string; // invoice # / externalId, falling back to the vendor
  issueDate: string | null;
  status: string; // draft | pending | approved
  lineName: string;
  cost: number;
}

/** One time entry behind a cost code's "labor" total in getJobCostDetail. */
export interface CostCodeTimeContributor {
  id: string;
  code: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  notes: string;
  isApproved: boolean;
}

export interface JobCostContributors {
  bills: CostCodeBillContributor[];
  time: CostCodeTimeContributor[];
}

/**
 * Every individual vendor-bill line and time entry behind getJobCostDetail's
 * per-code "bills" and "labor" totals — that function only ever returns the
 * sum (`_sumCostByCostCode` / `_sumTimeByCostCode` group server-side), so this
 * is what the Invoicing board's cost-code rail drills into on a click.
 *
 * Bills reuse the exact CTC_ACTUAL_WHERE predicate the totals are built from,
 * fetched at line granularity instead of grouped, with the same document
 * identity fields `getJobBillsForMonth` already reads (account/fromName,
 * externalId/number/subject, issueDate, status) — no new field, just a new
 * combination of already-confirmed ones. Time entries reuse the exact
 * unfiltered node shape `getUninvoicedBills` already fetches for the whole
 * job; grouping by cost code happens here instead of by month there.
 *
 * Fetched once per job (not once per code — the whole job's contributors come
 * back together and the client slices by `code`), and cached alongside
 * budget/CTC/costDetail at JOB_COST_TTL_MS, cleared by clearJobCostCaches().
 */
export function getJobCostContributors(
  cfg: PaveConfig,
  jobId: string,
): Promise<JobCostContributors> {
  return cachedRef(_jobCostKey("contributors", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getJobCostContributorsUncached(cfg, jobId),
  );
}
async function _getJobCostContributorsUncached(
  cfg: PaveConfig,
  jobId: string,
): Promise<JobCostContributors> {
  const billNodes: any[] = [];
  {
    let cursor: string | null = null;
    for (let page = 0; page < 30; page++) {
      const args: Record<string, unknown> = { size: 100, where: CTC_ACTUAL_WHERE };
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
              costCode: { number: {} },
              document: {
                id: {},
                status: {},
                issueDate: {},
                createdAt: {},
                externalId: {},
                number: {},
                subject: {},
                fromName: {},
                account: { name: {} },
              },
            },
          },
        },
      });
      const co = r?.job?.costItems ?? {};
      billNodes.push(...(co.nodes ?? []));
      cursor = co.nextPage ?? null;
      if (!cursor) break;
    }
  }

  const timeNodes: any[] = [];
  {
    let cursor: string | null = null;
    for (let page = 0; page < 30; page++) {
      const args: Record<string, unknown> = { size: 100 };
      if (cursor) args.page = cursor;
      const r = await pave(cfg, {
        job: {
          $: { id: jobId },
          id: {},
          timeEntries: {
            $: args,
            nextPage: {},
            nodes: {
              id: {},
              cost: {},
              startedAt: {},
              minutes: {},
              notes: {},
              isApproved: {},
              user: { name: {} },
              costItem: { costCode: { number: {} } },
            },
          },
        },
      });
      const tc = r?.job?.timeEntries ?? {};
      timeNodes.push(...(tc.nodes ?? []));
      cursor = tc.nextPage ?? null;
      if (!cursor) break;
    }
  }

  const bills: CostCodeBillContributor[] = billNodes
    .map((n) => {
      const d = n.document ?? {};
      const vendor = String(d?.account?.name ?? d?.fromName ?? "").trim() || "Unknown vendor";
      const ref = String(d?.externalId ?? d?.number ?? "").trim();
      return {
        id: n.id,
        docId: d.id,
        code: String(n?.costCode?.number ?? "").trim(),
        vendor,
        label: ref ? `${vendor} · ${ref}` : String(d?.subject ?? "").trim() || vendor,
        issueDate: d.issueDate ?? null,
        status: d.status ?? "",
        lineName: String(n?.name ?? "").trim(),
        cost: typeof n?.cost === "number" ? n.cost : 0,
      };
    })
    .filter((b) => b.code)
    .sort(
      (a, b) =>
        String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")) || b.cost - a.cost,
    );

  const time: CostCodeTimeContributor[] = timeNodes
    .map((n) => ({
      id: n.id,
      code: String(n?.costItem?.costCode?.number ?? "").trim(),
      employee: n?.user?.name ?? "Unknown",
      startedAt: n.startedAt ?? null,
      hours: (n.minutes ?? 0) / 60,
      cost: typeof n?.cost === "number" ? n.cost : 0,
      notes: String(n?.notes ?? "").trim(),
      isApproved: Boolean(n?.isApproved),
    }))
    .filter((t) => t.code)
    .sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));

  return { bills, time };
}

/** A bill as the coding board lists it — no CSI rollup, that comes from its lines. */
export interface MonthBill {
  id: string;
  label: string; // invoice # / externalId, falling back to the vendor
  /** Vendor Bill Number (JobTread externalId) — the invoice/bill number, editable
   *  in the board's Filing card. Null when the bill carries none. */
  externalId: string | null;
  /** JobTread's own document number, shown as the placeholder when there's no externalId. */
  number: string | null;
  vendor: string;
  cost: number;
  status: string; // draft | pending | approved
  issueDate: string | null;
  /** When the bill was created in JobTread — newest-first is the board's order. */
  createdAt: string | null;
  /** "Bill" (payable, approves to pending) or "Expense" (already paid, approves to approved). */
  name: string;
  /** Fixed sales tax carved out of the bill total — the gross-up input. */
  nonRecoverableTax: number;
  /** Label for the fixed tax amount, e.g. "Sales Tax" — shown alongside the amount. */
  nonRecoverableTaxName: string | null;
  /** false = this bill will sync to QuickBooks on approval. */
  qboIsIgnored: boolean;
  /** Already on a customer invoice — the board renders these read-only. */
  invoiced: boolean;
  /** Attached files (the scanned invoice) — 0 means nothing to review against. */
  fileCount: number;
}

/**
 * The job's vendor bills whose Invoice Date falls in one month, excluding any
 * already on a customer invoice.
 *
 * `getUninvoicedBills` answers a bigger question (it also walks time entries and
 * the job's whole flat costItems connection to build a per-bill CSI rollup), and
 * the board needs neither: it derives per-code amounts from getBillLinesForJob,
 * which carries strictly more detail. Calling that here meant paying for the same
 * cost-item walk twice — measured 4.8 s for one board load.
 *
 * The month filter runs SERVER-side. Confirmed live 2026-08-05: the `>=` / `<=`
 * comparison operators work on `issueDate`, returning Otis Perkins' 43 July bills
 * in ONE page / 363 ms where the unnarrowed status-only walk needed 7 pages.
 * Falls back to the unnarrowed walk + in-script date filter if that form is ever
 * rejected. Page size stays 25 because `referencedDocuments` nested in a paged
 * documents connection 413s above that (the same reason getUninvoicedBills uses 25).
 *
 * NOTE the billing month here is simply the month of the bill's Invoice Date. The
 * 10th-of-the-month rule is an INGESTION convention (`deriveBillingPeriod`) that
 * decides which issueDate a newly-arrived bill is given — it is not a filter.
 *
 * `includeInvoiced` widens the list to a past, fully-invoiced month for VIEWING
 * (the Tracking Sheets board otherwise goes empty next to its own "Reconciled"
 * badge). Recoding an already-invoiced bill would change numbers already sent
 * to the client, so the board renders those bills read-only rather than gating
 * them out of the query entirely.
 */
export async function getJobBillsForMonth(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
  includeDrafts: boolean,
  includeInvoiced = false,
): Promise<MonthBill[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const statuses = includeDrafts ? ["draft", "pending", "approved"] : ["pending", "approved"];

  const walk = async (where: unknown): Promise<any[]> => {
    const out: any[] = [];
    let page: string | undefined;
    let guard = 0;
    do {
      const r = await pave(cfg, {
        job: {
          $: { id: jobId },
          documents: {
            $: { where, size: 25, ...(page ? { page } : {}) },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              subject: {},
              externalId: {},
              number: {},
              fromName: {},
              cost: {},
              issueDate: {},
              createdAt: {},
              status: {},
              nonRecoverableTax: {},
              nonRecoverableTaxName: {},
              qboIsIgnored: {},
              account: { name: {} },
              referencedDocuments: { nodes: { type: {} } },
              files: { count: {} },
            },
          },
        },
      });
      out.push(...(r?.job?.documents?.nodes ?? []));
      page = r?.job?.documents?.nextPage || undefined;
    } while (page && ++guard < 100);
    return out;
  };

  let nodes: any[];
  try {
    nodes = await walk({
      and: [
        { "=": [{ field: "type" }, { value: "vendorBill" }] },
        { in: [{ field: "status" }, statuses.map((v) => ({ value: v }))] },
        { ">=": [{ field: "issueDate" }, { value: first }] },
        { "<=": [{ field: "issueDate" }, { value: last }] },
      ],
    });
  } catch {
    nodes = await walk({ and: [["type", "vendorBill"], ["status", "in", statuses]] });
  }

  const inMonth = (d?: string) => {
    const s = String(d ?? "").slice(0, 10);
    return s >= first && s <= last;
  };
  const isInvoiced = (b: any) =>
    (b.referencedDocuments?.nodes ?? []).some((n: any) => n.type === "customerInvoice");

  return nodes
    .filter((b) => inMonth(b.issueDate) && (includeInvoiced || !isInvoiced(b)))
    .map((b) => {
      const vendor = String(b?.account?.name ?? b?.fromName ?? "").trim() || "Unknown vendor";
      const ref = String(b?.externalId ?? b?.number ?? "").trim();
      // Only Sunset bills show their invoice id: a Sunset statement is a stack
      // of many small invoices, so the invoice # is how you tell them apart.
      // Every other vendor is shown by name alone.
      const isSunset = /sunset/i.test(vendor);
      return {
        id: b.id,
        label: ref && isSunset ? `${vendor} · ${ref}` : vendor,
        externalId: b?.externalId ? String(b.externalId) : null,
        number: b?.number != null ? String(b.number) : null,
        vendor,
        cost: typeof b?.cost === "number" ? b.cost : 0,
        status: b?.status ?? "",
        issueDate: b?.issueDate ?? null,
        createdAt: b?.createdAt ?? null,
        name: b?.name ?? "Bill",
        nonRecoverableTax: typeof b?.nonRecoverableTax === "number" ? b.nonRecoverableTax : 0,
        nonRecoverableTaxName: b?.nonRecoverableTaxName ?? null,
        qboIsIgnored: !!b?.qboIsIgnored,
        invoiced: isInvoiced(b),
        fileCount: typeof b?.files?.count === "number" ? b.files.count : 0,
      };
    })
    // Newest first: the board is worked as bills arrive, so the ones that just
    // landed are the ones still needing coding. Falls back to issueDate then
    // cost so an older record with no createdAt still sorts predictably.
    .sort(
      (a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) ||
        String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")) ||
        b.cost - a.cost,
    );
}

/** One time entry, for the Bills list's "Time & labor" block. */
export interface MonthTimeEntry {
  id: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  code: string;
  codeName: string;
  notes: string;
  isApproved: boolean;
  /**
   * The budget leaf this entry is coded to — the SAME `jobCostItemId` a bill
   * line points at, and what Labor Review re-points to recode the entry. Null
   * on an entry JobTread has no cost item for.
   */
  costItemId: string | null;
  /** The pay type (rate) the entry was logged under, e.g. "Regular Pay". */
  type: string;
  /**
   * The clock-out instant, null on an entry still running. Carried so an
   * editing surface can show — and rewrite — the actual window worked rather
   * than only the duration JobTread derived from it.
   */
  endedAt: string | null;
  /**
   * JobTread's OWN minute count. Usually endedAt − startedAt, but not always:
   * a break deduction makes it smaller. `hours` is this figure, not the span,
   * so an editor that rewrites the span must expect JobTread to recompute.
   */
  minutes: number;
}

/**
 * A job's time entries whose startedAt falls in one month — labor shown
 * alongside the vendor bills it'll be invoiced next to, instead of only
 * living in the cost-code rail's total.
 *
 * The `startedAt` range narrows server-side — confirmed live 2026-08-06 on
 * job.timeEntries (same field, same `{and:[[path,op,value],...]}` shape
 * `getJobBillsForMonth` already uses for issueDate): an out-of-range window
 * came back empty, an in-range one didn't. Falls back to an unnarrowed walk +
 * client-side filter, the same safety net every other month-scoped query here
 * uses, if that shape is ever rejected.
 */
export async function getJobTimeEntriesForMonth(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<MonthTimeEntry[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const inMonth = (d?: string | null) => {
    const s = String(d ?? "").slice(0, 10);
    return s >= first && s <= last;
  };

  const walk = async (where: unknown): Promise<any[]> => {
    const nodes: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 30; page++) {
      const args: Record<string, unknown> = { size: 100, ...(where ? { where } : {}) };
      if (cursor) args.page = cursor;
      const r = await pave(cfg, {
        job: {
          $: { id: jobId },
          id: {},
          timeEntries: {
            $: args,
            nextPage: {},
            nodes: {
              id: {},
              cost: {},
              startedAt: {},
              minutes: {},
              endedAt: {},
              notes: {},
              isApproved: {},
              type: {},
              user: { name: {} },
              costItem: { id: {}, costCode: { number: {}, name: {} } },
            },
          },
        },
      });
      const tc = r?.job?.timeEntries ?? {};
      nodes.push(...(tc.nodes ?? []));
      cursor = tc.nextPage ?? null;
      if (!cursor) break;
    }
    return nodes;
  };

  let nodes: any[];
  try {
    nodes = await walk({
      and: [
        ["startedAt", ">=", first],
        ["startedAt", "<=", `${last}T23:59:59`],
      ],
    });
  } catch {
    nodes = (await walk(undefined)).filter((n) => inMonth(n?.startedAt));
  }

  return nodes
    .filter((n) => inMonth(n?.startedAt))
    .map((n) => ({
      id: n.id,
      employee: n?.user?.name ?? "Unknown",
      startedAt: n.startedAt ?? null,
      hours: (n.minutes ?? 0) / 60,
      cost: typeof n?.cost === "number" ? n.cost : 0,
      code: n?.costItem?.costCode?.number?.toString().trim() ?? "",
      codeName: n?.costItem?.costCode?.name ?? "",
      notes: String(n?.notes ?? "").trim(),
      isApproved: Boolean(n?.isApproved),
      costItemId: n?.costItem?.id ?? null,
      type: String(n?.type ?? "").trim(),
      endedAt: n.endedAt ?? null,
      minutes: typeof n?.minutes === "number" ? n.minutes : 0,
    }))
    .sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));
}

/** One vendor-bill line, with the coding target the Invoicing board moves it between. */
export interface JobBillLine {
  id: string; // costItemId — what updateLine() edits
  docId: string; // the bill this line belongs to
  billStatus: string; // draft | pending | approved — draft cost isn't committed yet
  name: string;
  cost: number;
  quantity?: number;
  unitCost?: number;
  code: string; // costCode.number — always tracks jobCostItem's code (verified, see below)
  codeName: string;
  jobCostItemId: string | null; // the budget leaf it codes to; null = uncoded
}

/**
 * Every line on the given bills, in ONE query instead of one `getBillDetail` per
 * bill (30 bills would be 30 round trips).
 *
 * Confirmed live 2026-08-05 across 4 jobs / 793 vendor-bill cost items: a line's
 * `costCode` ALWAYS equals its `jobCostItem`'s cost code — zero mismatches. So
 * JobTread derives the line's code from its coding target, which is what makes
 * `updateLine({ jobCostItemId })` a complete recode with no second write.
 *
 * The document-id narrowing runs server-side; if that `where` shape is ever
 * rejected we fall back to walking the job's vendor-bill lines and filtering here,
 * so the board can't come up empty.
 */
export async function getBillLinesForJob(
  cfg: PaveConfig,
  jobId: string,
  docIds: string[],
): Promise<JobBillLine[]> {
  const wanted = new Set(docIds);
  if (wanted.size === 0) return [];

  const walk = async (where: unknown): Promise<any[]> => {
    const nodes: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const args: Record<string, unknown> = { size: 100, where };
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
              quantity: {},
              unitCost: {},
              document: { id: {}, status: {} },
              costCode: { number: {}, name: {} },
              jobCostItem: { id: {} },
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
  };

  let nodes: any[];
  try {
    nodes = await walk({
      in: [{ field: ["document", "id"] }, [...wanted].map((v) => ({ value: v }))],
    });
  } catch {
    nodes = await walk([["document", "type"], "vendorBill"]);
  }

  return nodes
    .filter((n) => n?.document?.id && wanted.has(n.document.id))
    .map((n) => ({
      id: n.id,
      docId: n.document.id,
      billStatus: n.document.status ?? "",
      name: String(n?.name ?? "").trim(),
      cost: typeof n?.cost === "number" ? n.cost : 0,
      quantity: typeof n?.quantity === "number" ? n.quantity : undefined,
      unitCost: typeof n?.unitCost === "number" ? n.unitCost : undefined,
      code: n?.costCode?.number?.toString().trim() ?? "",
      codeName: n?.costCode?.name ?? "",
      jobCostItemId: n?.jobCostItem?.id ?? null,
    }));
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

/**
 * jobId → the job's "Phase" custom-field value, for the /jobs filter.
 *
 * Two phases on purpose: nesting `customFieldValues` inside the paged
 * organization.jobs connection returns HTTP 413 (the 413 rule in
 * JT_API_REFERENCE.md), so we look the field up once by name and then page its
 * values, each of which carries the job it belongs to. Same shape the Apps
 * Script project sync uses (`_jtProjCf(job, "Phase")`, JobTread.js).
 *
 * Cached at the same 5 min as `getJobs` — the two are always read together and a
 * Phase is a human edit in JobTread, not something the Companion writes.
 */
export function getJobPhaseMap(cfg: PaveConfig): Promise<Record<string, string>> {
  return cachedRef(`jobphase:${cfg.orgId}`, 5 * 60_000, () => _getJobPhaseMapUncached(cfg));
}
async function _getJobPhaseMapUncached(cfg: PaveConfig): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const cf = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {} } },
    },
  });
  const fields: any[] = cf?.organization?.customFields?.nodes ?? [];
  const field =
    fields.find((f) => f?.name === "Phase" && f?.targetType === "job") ??
    fields.find((f) => f?.name === "Phase");
  if (!field?.id) return out; // no Phase field configured — the filter just shows nothing to filter on

  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      customField: {
        $: { id: field.id },
        id: {},
        customFieldValues: {
          $: args,
          nextPage: {},
          nodes: { value: {}, job: { id: {} } },
        },
      },
    });
    const conn = r?.customField?.customFieldValues ?? {};
    for (const n of conn.nodes ?? []) {
      const jobId = n?.job?.id;
      if (!jobId || n?.value == null) continue;
      const v = typeof n.value === "string" ? n.value : String(n.value);
      if (v.trim()) out[jobId] = v.trim();
    }
    cursor = conn.nextPage ?? null;
    if (!cursor) break;
  }
  return out;
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

export interface VendorBillRow {
  id: string;
  number: number | null;
  jobId: string | null;
  jobName: string;
  cost: number;
  status: string;
  issueDate: string | null;
}

/**
 * One vendor's bills — job, date, amount, status — newest issueDate first.
 * JobTread's own vendor search only lists a bill's number; this is the list
 * behind it, for the /vendors page.
 *
 * Confirmed live (2026-08): `account.documents` supports the same
 * `["type","vendorBill"]` filter used elsewhere in this file, `sortBy
 * issueDate desc` runs server-side, and `job` is a plain reference (not a
 * heavy nested connection) so it carries no 413 risk even for a high-volume
 * vendor like Sunset.
 */
export async function getVendorBills(cfg: PaveConfig, accountId: string): Promise<VendorBillRow[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const args: Record<string, unknown> = {
      where: { and: [["type", "vendorBill"]] },
      size: 100,
      sortBy: [{ field: "issueDate", order: "desc" }],
    };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      account: {
        $: { id: accountId },
        id: {},
        documents: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            cost: {},
            status: {},
            issueDate: {},
            job: { id: {}, name: {} },
          },
        },
      },
    });
    const conn = r?.account?.documents ?? {};
    out.push(...(conn.nodes ?? []));
    cursor = conn.nextPage ?? null;
    if (!cursor) break;
  }
  return out.map((b) => ({
    id: b.id,
    number: typeof b?.number === "number" ? b.number : null,
    jobId: b?.job?.id ?? null,
    jobName: b?.job?.name ?? "—",
    cost: typeof b?.cost === "number" ? b.cost : 0,
    status: b?.status ?? "",
    issueDate: b?.issueDate ?? null,
  }));
}

export interface VendorBillMatch extends VendorBillRow {
  vendorName: string;
}

/**
 * Org-wide bill-number lookup. Bill numbers are NOT unique across vendors —
 * confirmed live: #98 matches three different vendors/jobs — so this always
 * returns every match rather than assuming one, using `organization.documents`
 * (the org-wide connection; `document.account { name }` resolves directly so
 * no second query is needed to disambiguate the results).
 */
export async function getBillsByNumber(cfg: PaveConfig, number: number): Promise<VendorBillMatch[]> {
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      documents: {
        $: {
          where: { and: [["type", "vendorBill"], ["number", number]] },
          size: 50,
        },
        nodes: {
          id: {},
          number: {},
          cost: {},
          status: {},
          issueDate: {},
          job: { id: {}, name: {} },
          account: { name: {} },
        },
      },
    },
  });
  const nodes = (r?.organization?.documents?.nodes ?? []) as any[];
  return nodes.map((b) => ({
    id: b.id,
    number: typeof b?.number === "number" ? b.number : null,
    jobId: b?.job?.id ?? null,
    jobName: b?.job?.name ?? "—",
    cost: typeof b?.cost === "number" ? b.cost : 0,
    status: b?.status ?? "",
    issueDate: b?.issueDate ?? null,
    vendorName: b?.account?.name ?? "Unknown vendor",
  }));
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
  fields: {
    name?: string;
    jobCostItemId?: string;
    quantity?: number;
    unitCost?: number;
    description?: string;
  },
): Promise<{ id: string }> {
  const $: Record<string, unknown> = { id: costItemId };
  if (fields.name !== undefined) $.name = fields.name.substring(0, 250);
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
 * Resolve the "Ascent - Shop" overhead job by name/customer (confirmed live:
 * JT job name "Shop" under customer/account "Ascent") rather than hardcoding
 * its id, so buyback doesn't silently break if the job is ever re-created.
 * Cached alongside getJobs (5 min) — the two are always read together.
 */
export function resolveShopJobId(cfg: PaveConfig): Promise<string> {
  return cachedRef(`shopjob:${cfg.orgId}`, 5 * 60_000, () => _resolveShopJobIdUncached(cfg));
}
async function _resolveShopJobIdUncached(cfg: PaveConfig): Promise<string> {
  const jobs = await getJobs(cfg, true); // include closed — fail loud, not silent, if it's ever closed
  const hit = jobs.find(
    (j) => j.name.trim().toLowerCase() === "shop" && (j.customer ?? "").trim().toLowerCase() === "ascent",
  );
  if (!hit) throw new Error('Could not find the "Ascent - Shop" job in JobTread.');
  return hit.id;
}

export interface BuybackLineArgs {
  sourceDocId: string;
  costItemId: string; // the line to move off the client bill
  name: string;
  unitCost: number; // pre-tax dollar amount for this one line (written at quantity 1)
  description?: string;
}

/**
 * Idempotency check for buyback, scoped to the Shop job's OWN documents rather
 * than the vendor account's entire history. findBillByExternalId (used
 * elsewhere for this) pages through every document a vendor has ever had —
 * fine for a normal vendor, but a first live run against Sunset Builders
 * Supply (thousands of historical invoices) ran long enough to blow past the
 * route's function timeout: JobTread had already created the Shop bill by
 * the time the function got killed, but never reached the line move (bug
 * found 2026-08-05 — a Shop bill named "Buyback — …Sunset…" with 0 lines).
 * Paging the Shop job's documents instead is bounded by how many buyback
 * bills THIS job has ever accumulated, not by any one vendor's volume.
 */
async function findShopBuybackBill(
  cfg: PaveConfig,
  shopJobId: string,
  externalId: string,
): Promise<string | null> {
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const args: Record<string, unknown> = { size: 100, where: { and: [["type", "vendorBill"]] } };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      job: {
        $: { id: shopJobId },
        documents: { $: args, nextPage: {}, nodes: { id: {}, externalId: {} } },
      },
    });
    const docs = r?.job?.documents ?? {};
    const nodes: any[] = docs.nodes ?? [];
    for (const n of nodes) {
      if (String(n.externalId ?? "").trim() === externalId) return n.id;
    }
    cursor = docs.nextPage ?? null;
    if (!cursor || nodes.length === 0) break;
  }
  return null;
}

/**
 * The Shop job's generic "Uncategorized" catch-all budget leaf. Confirmed live
 * 2026-08-05: JobTread REJECTS createCostItem on an existing vendor bill with
 * no jobCostItemId ("A jobCostItemId is required to create a new cost item for
 * this Vendor Bill", 400) — unlike a brand-new bill's initial lineItems array,
 * which tolerates an uncoded line fine. So a buyback line can't truly land
 * uncoded; it lands on this catch-all instead, and the ORIGINAL code (if any)
 * rides along in the new line's description so the office can re-code it
 * properly from there. getJobBudget deliberately excludes "Uncategorized"
 * leaves from the coding dropdown, so this reads job.costItems directly.
 */
async function resolveShopCatchAllLeaf(cfg: PaveConfig, shopJobId: string): Promise<string> {
  return cachedRef(`shopcatchall:${cfg.orgId}:${shopJobId}`, 5 * 60_000, async () => {
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const args: Record<string, unknown> = { size: 100 };
      if (cursor) args.page = cursor;
      const r = await pave(cfg, {
        job: {
          $: { id: shopJobId },
          costItems: { $: args, nextPage: {}, nodes: { id: {}, name: {}, document: { id: {} } } },
        },
      });
      const co = r?.job?.costItems ?? {};
      const nodes: any[] = co.nodes ?? [];
      const hit = nodes.find(
        (n) => !n.document?.id && /^uncategorized\b/i.test(String(n.name ?? "").trim()),
      );
      if (hit) return hit.id as string;
      cursor = co.nextPage ?? null;
      if (!cursor) break;
    }
    throw new Error('No "Uncategorized" budget leaf found on the Shop job.');
  });
}

/**
 * WRITE — "buyback": move one bill line off a client job's bill onto a draft bill
 * on the Ascent - Shop job (e.g. materials bought back for shop stock instead of
 * billed to the client). Reuses the same externalId idempotency trick
 * createVendorBill's callers use elsewhere (`BUYBACK-<sourceDocId>`, scoped to
 * the SHOP job's documents — see findShopBuybackBill) so repeated buybacks off
 * the SAME source bill land additively on the SAME shop bill instead of each
 * click minting a new one; this also means the frontend needs no session state
 * to track "the shop bill I already created" — a second click just finds it
 * again.
 *
 * The new line lands on Shop's generic "Uncategorized" leaf (see
 * resolveShopCatchAllLeaf — JobTread requires SOME jobCostItemId here, and a
 * client job's coding can't carry over anyway since it's a different job's
 * budget tree); `description` carries the original code's label for reference.
 * Tax stays behind on the source bill's nonRecoverableTax (untouched, same as
 * deleteLine); the shop bill itself is created tax-free.
 *
 * Draft-only per caller (JT locks a bill's amounts once it leaves draft).
 */
export async function buybackLine(
  cfg: PaveConfig,
  args: BuybackLineArgs,
): Promise<{ shopDocId: string; created: boolean }> {
  const [shopJobId, doc] = await Promise.all([
    resolveShopJobId(cfg),
    pave(cfg, {
      document: {
        $: { id: args.sourceDocId },
        id: {},
        subject: {},
        fromName: {},
        issueDate: {},
        account: { id: {} },
      },
    }),
  ]);
  const src = doc?.document ?? {};
  const accountId = src.account?.id;
  if (!accountId) throw new Error("Source bill has no vendor account — can't create a Shop copy.");

  const buybackExternalId = `BUYBACK-${args.sourceDocId}`.substring(0, 32);
  const [shopDocIdFound, catchAllLeafId] = await Promise.all([
    findShopBuybackBill(cfg, shopJobId, buybackExternalId),
    resolveShopCatchAllLeaf(cfg, shopJobId),
  ]);
  let shopDocId = shopDocIdFound;
  let created = false;
  if (!shopDocId) {
    // Ascent - Shop has a name but no street address; jobLocationName alone
    // satisfies createDocument's location requirement (confirmed by amazon-import).
    const shopInfo = await getJobHeaderInfo(cfg, shopJobId);
    const { id } = await createVendorBill(cfg, {
      jobId: shopJobId,
      accountId,
      vendorName: src.fromName || "Vendor",
      subject: `Buyback — ${src.subject || src.fromName || "Vendor bill"}`,
      externalId: buybackExternalId,
      issueDate: src.issueDate || new Date().toISOString().slice(0, 10),
      taxAmount: 0,
      jobLocationName: shopInfo.name || undefined,
      jobLocationAddress: shopInfo.address || undefined,
      lines: [],
    });
    shopDocId = id;
    created = true;
  }

  // Land the line on the shop bill BEFORE removing it from the source — if the
  // delete below fails, the cost is duplicated (easy to notice) rather than lost.
  await createLine(cfg, shopDocId, {
    name: args.name,
    quantity: 1,
    unitCost: args.unitCost,
    jobCostItemId: catchAllLeafId,
    description: args.description,
  });
  await deleteLine(cfg, args.costItemId);

  return { shopDocId, created };
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
  // Draft (still-coding) bills for the month. NOT part of remaining/reconciled —
  // JobTread won't pull a draft onto an invoice — but reported so the office can
  // see why the card's preview total is higher than the invoiceable amount.
  draftBillsCost: number;
  draftBillCount: number;
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
 * Draft bills are intentionally excluded from the completeness math — they aren't
 * invoiceable yet, so they can't count as "still uninvoiced". They ARE summed
 * separately (`draftBillsCost`), because the Invoicing card's preview total
 * includes drafts: without that figure the two numbers on the card look like a
 * bug instead of "this much is still in the coding queue".
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

  // 1. Vendor bills for the month, each with the invoice ids it's on. Only the
  //    FINALIZED ones (pending/approved) feed the completeness math; drafts are
  //    pulled in the same query and merely tallied (see draftBillsCost).
  //    Paged at 25 — referencedDocuments nested in paged documents 413s larger.
  const monthBills: { cost: number; invIds: string[] }[] = [];
  let draftBillsCost = 0;
  let draftBillCount = 0;
  let page: string | undefined;
  let guard = 0;
  do {
    const r: any = await pave(cfg, {
      job: {
        $: { id: jobId },
        documents: {
          $: {
            where: {
              and: [["type", "vendorBill"], ["status", "in", ["draft", "pending", "approved"]]],
            },
            size: 25,
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: {
            id: {},
            cost: {},
            issueDate: {},
            status: {},
            referencedDocuments: { nodes: { id: {}, type: {}, status: {} } },
          },
        },
      },
    });
    for (const b of (r?.job?.documents?.nodes ?? []) as any[]) {
      if (!inMonth(b.issueDate)) continue;
      if (b.status === "draft") {
        draftBillsCost += b.cost ?? 0;
        draftBillCount++;
        continue;
      }
      monthBills.push({ cost: b.cost ?? 0, invIds: invRefIds(b) });
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
    draftBillsCost: Math.round(draftBillsCost * 100) / 100,
    draftBillCount,
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
 *
 * `costItemId` RE-CODES the entry — this is Labor Review's whole write, and the
 * exact analogue of updateLine()'s `jobCostItemId` for a bill line. Confirmed
 * live 2026-08-10 (read → recode → read back → restore, on a real entry):
 * re-pointing costItemId moves the entry to the new budget leaf's cost code and
 * leaves `cost`, `minutes`, `type` and `isApproved` UNTOUCHED. That's the
 * important half — a time entry's cost is hours × the PAY TYPE's rate, so it
 * does NOT get recomputed from the cost item, and unlike createCostItem there is
 * no tax carve to lose money to. Recoding therefore moves labor between codes at
 * exactly the amount already on the entry.
 *
 * A cost code JobTread doesn't allow time against is rejected at write time (no
 * queryable "time-trackable" flag exists) — rewriteTimeEntryError turns that
 * into something the office can act on.
 *
 * `startedAt`/`endedAt` RE-TIME the entry and `jobId` MOVES it. Both confirmed
 * live 2026-08-25 (probeTimeEntryRetimeAndRejob — a [PROBE] entry cloned off a
 * real one, mutated, read back, deleted):
 *
 *   - RE-TIMING RECOMPUTES THE MONEY. A 2h window rewritten to 3h came back
 *     minutes 120 → 180 and cost 150 → 225, i.e. JobTread derives minutes from
 *     the new span and cost is minutes × the pay type's rate ($75/h here).
 *     Unlike a recode, this DOES change the dollars — say so on screen.
 *   - A JOB MOVE NEEDS ITS COST ITEM. `jobId` alone is rejected outright:
 *     HTTP 400 "A job & cost item are required for this time entry" — JobTread
 *     will not let an entry strand on another job's cost item. Sent together,
 *     `{ jobId, costItemId }` moves the entry and leaves cost and minutes
 *     untouched. Cost items are per-job, so the pair is the only legal form.
 *
 * Timestamps here are UTC INSTANTS — build them with orgLocalToJtIso(), never
 * from a bare wall clock (see the note at the top of this section).
 */
export async function updateTimeEntry(
  cfg: PaveConfig,
  id: string,
  fields: {
    startedAt?: string;
    endedAt?: string;
    notes?: string;
    costItemId?: string;
    jobId?: string;
    isApproved?: boolean;
  },
): Promise<{ id: string; startedAt?: string; endedAt?: string; minutes?: number }> {
  const $: Record<string, unknown> = { id };
  if (fields.startedAt !== undefined) $.startedAt = fields.startedAt;
  if (fields.endedAt !== undefined) $.endedAt = fields.endedAt;
  if (fields.notes !== undefined) $.notes = fields.notes;
  if (fields.costItemId !== undefined) $.costItemId = fields.costItemId;
  if (fields.jobId !== undefined) $.jobId = fields.jobId;
  if (fields.isApproved !== undefined) $.isApproved = fields.isApproved;
  try {
    const r = await pave(cfg, {
      updateTimeEntry: {
        $,
        timeEntry: { $: { id }, id: {}, startedAt: {}, endedAt: {}, minutes: {} },
      },
    });
    const t = r?.updateTimeEntry?.timeEntry;
    return { id: t?.id ?? id, startedAt: t?.startedAt, endedAt: t?.endedAt, minutes: t?.minutes };
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

/**
 * READ — the owning user's id for one time entry, via the root `timeEntry(id)`
 * accessor. Used to gate an edit: a signed-in employee may only change their
 * OWN time, and the entry id comes from the client, so the write path re-reads
 * the owner here and compares it to the session's resolved JobTread user id
 * rather than trusting the request. Returns null when the entry doesn't exist
 * (e.g. deleted since the timesheet was loaded).
 */
export async function getTimeEntryOwner(cfg: PaveConfig, id: string): Promise<string | null> {
  const r = await pave(cfg, { timeEntry: { $: { id }, id: {}, user: { id: {} } } });
  return r?.timeEntry?.user?.id ?? null;
}

export interface UserTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** JobTread's OWN duration for the entry (break-deducted), 0 while running. */
  minutes: number;
  /** timeEntry.isApproved — the payroll approval mark shown on the timesheet. */
  approved: boolean;
  notes: string;
  jobId: string;
  jobName: string;
  /** The job's customer account name, for the "job / customer" timesheet row. */
  customer: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  /** timeEntry.type — the pay-type NAME. */
  payType: string;
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
            type: {},
            startedAt: {},
            endedAt: {},
            minutes: {},
            isApproved: {},
            notes: {},
            job: { id: {}, name: {}, location: { account: { name: {} } } },
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
        minutes: Number(n.minutes) || 0,
        approved: !!n.isApproved,
        notes: n.notes ?? "",
        jobId: n.job?.id ?? "",
        jobName: n.job?.name ?? "",
        customer: n.job?.location?.account?.name ?? "",
        costItemId: n.costItem?.id ?? "",
        costCode: n.costItem?.costCode?.number ?? "",
        costItemName: n.costItem?.costCode?.name || n.costItem?.name || "",
        payType: n.type ?? "",
      });
    }
    cursor = tc.nextPage ?? null;
    if (!cursor) break;
  }
  return out;
}

export interface OpenTimeEntry {
  id: string;
  startedAt: string; // UTC instant ISO, as JobTread stores it
  payType: string; // timeEntry.type — the pay-type NAME
  notes: string;
  jobId: string;
  jobName: string;
  customer: string;
  jobLabel: string; // "Customer - Job" when the customer is known, else the job name
  costItemId: string;
  costCode: string;
  costItemName: string;
}

/**
 * READ — a user's still-RUNNING time entries (clocked in, never clocked out):
 * `endedAt` is null. This is what makes a clock-in resumable from any device —
 * JobTread, not one phone's localStorage, is the source of truth for "am I on
 * the clock right now".
 *
 * Deliberately a separate function from getUserTimeEntries rather than a flag on
 * it: this one pulls a RICHER field set (`type` for the pay type, the job's
 * customer for the "Customer - Job" label, `costItem.id` so the clock-out can
 * log the same cost item) that the bi-monthly "My Time" list doesn't need, and
 * keeping them apart means a change here can't break that view.
 *
 * `endedAt` is filtered CLIENT-side — the `where` grammar's null handling isn't
 * probe-confirmed, and `startedAt` bounding (which IS confirmed, see
 * getUserTimeEntries) already keeps the pull to one small page. `opts.sinceIso`
 * should be a few days back: it bounds the fetch AND stops a long-forgotten
 * clock-in from resurfacing weeks later as if it were live.
 */
export async function getOpenTimeEntries(
  cfg: PaveConfig,
  userId: string,
  opts: { sinceIso?: string; maxPages?: number } = {},
): Promise<OpenTimeEntry[]> {
  const maxPages = opts.maxPages ?? 5;
  const out: OpenTimeEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const args: Record<string, unknown> = {
      size: 100,
      sortBy: [{ field: "startedAt", order: "desc" }],
    };
    if (cursor) args.page = cursor;
    if (opts.sinceIso) args.where = ["startedAt", ">=", opts.sinceIso];
    const r = await pave(cfg, {
      user: {
        $: { id: userId },
        id: {},
        timeEntries: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            type: {},
            startedAt: {},
            endedAt: {},
            notes: {},
            job: { id: {}, name: {}, location: { account: { name: {} } } },
            costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
          },
        },
      },
    });
    const tc = r?.user?.timeEntries ?? {};
    for (const n of tc.nodes ?? []) {
      if (n.endedAt) continue; // closed — not a running clock
      const jobName = n.job?.name ?? "";
      const customer = n.job?.location?.account?.name ?? "";
      out.push({
        id: n.id,
        startedAt: n.startedAt,
        payType: n.type ?? "",
        notes: n.notes ?? "",
        jobId: n.job?.id ?? "",
        jobName,
        customer,
        jobLabel: customer && jobName ? `${customer} - ${jobName}` : jobName,
        costItemId: n.costItem?.id ?? "",
        costCode: n.costItem?.costCode?.number ?? "",
        costItemName: n.costItem?.costCode?.name || n.costItem?.name || "",
      });
    }
    cursor = tc.nextPage ?? null;
    if (!cursor) break;
  }
  // Newest first, so the caller can take [0] as "the" running clock.
  return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

