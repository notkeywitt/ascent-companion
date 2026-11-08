// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { isSalesTaxLine, SALES_TAX_LINE_NAME, SALES_TAX_CSI } from "@/lib/salesTax";
import { WARRANTY_CSI } from "@/lib/warranty";
import { _jobCostKey, cachedRef, JOB_COST_TTL_MS, pageAll, pageEach, pave, type PaveConfig, PaveTooManyPagesError } from "./core";
import { CF_COST_CODES, QBO_EXPENSE_ACCOUNT_ID } from "./billIngestion";
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
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["status", "draft"],
            ],
          },
          size: 100,
        },
        nextPage: {},
        nodes,
      },
    },
  });
  const rich = {
    id: {},
    name: {},
    subject: {},
    fromName: {},
    number: {},
    externalId: {},
    status: {},
    cost: {},
    nonRecoverableTax: {},
    issueDate: {},
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
  const q = (nodes: Record<string, unknown>, args: Record<string, unknown>) => ({
    organization: {
      $: { id: cfg.orgId },
      id: {},
      documents: {
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["status", "draft"],
            ],
          },
          ...args,
        },
        nextPage: {},
        nodes,
      },
    },
  });
  const rich = {
    id: {},
    name: {},
    subject: {},
    fromName: {},
    number: {},
    externalId: {},
    status: {},
    cost: {},
    nonRecoverableTax: {},
    issueDate: {},
    job: { id: {}, name: {} },
  };
  const min = {
    id: {},
    name: {},
    status: {},
    cost: {},
    nonRecoverableTax: {},
    issueDate: {},
    job: { id: {}, name: {} },
  };
  const flatten = (nodes: any[]): DraftBill[] =>
    nodes.map((n) => ({ ...n, jobId: n?.job?.id, jobName: n?.job?.name }));

  const walkWith = (nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: "organization.documents (draft vendor bills)",
      query: (args) => q(nodes, args),
      pick: (r) => r?.organization?.documents,
    });

  // An unconfirmed field name won't break the queue: fall back to the minimal
  // field set. The retry restarts the walk rather than swapping field sets
  // mid-walk, so every page of one answer carries the same shape. Too much data
  // is not a shape problem — retrying that would only overflow again.
  const nodes = await walkWith(rich).catch((e) => {
    if (e instanceof PaveTooManyPagesError) throw e;
    return walkWith(min);
  });
  return flatten(nodes);
}

export interface BillLine {
  id: string;
  name?: string;
  description?: string; // the raw CSI — how isSalesTaxLine recognises an uncoded tax line
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
    /** The vendor account this bill is billed against — `document.account.name`,
     *  JobTread's actual vendor link. `fromName` is a free-text print-header
     *  field that JobTread defaults to whoever entered the bill, so a bill typed
     *  in by hand shows the OFFICE'S name there, not the vendor's — a real bug
     *  this field exists to fix. Prefer this everywhere a vendor is displayed. */
    vendorName?: string;
    /** The bill's own job and its customer, for the bill page's title. */
    jobName?: string;
    customerName?: string;
    number?: string;
    externalId?: string;
    status?: string;
    cost?: number;
    issueDate?: string;
    /** JobTread's "Payment Due" — the date the vendor's invoice is due, when the
     *  bill carries one. A JT document holds EITHER a `dueDate` or `dueDays`
     *  (net terms), never both, so an empty string here with `dueDays` set means
     *  the bill is on net terms rather than undated. */
    dueDate?: string;
    /** Net terms, when the bill has no explicit due date (30 = net-30). */
    dueDays?: number | null;
    qboIsIgnored?: boolean;
    /** QuickBooks "Push as": "bill" or "purchase" (= Expense). Null = JT's default,
     *  Bill. Read with `isExpenseDoc`, never alone — see there. */
    qboDocumentType?: string | null;
    /** Legacy document tax field — non-zero only on a bill pushed before
     *  2026-09-05. A bill's real sales tax is its 88 80 00 line plus this;
     *  `splitSalesTax` in src/lib/salesTax.ts resolves the pair. */
    nonRecoverableTax?: number;
    /** Is JobTread's "Record Tax" toggle ON? Stored as `nonRecoverableTaxName` — a
     *  name means the bill shows a document tax row, null means the row is off.
     *  Under the 2026-09-05 model that row must not exist (src/lib/salesTax.ts), so
     *  a save turns it back off. */
    recordsTax?: boolean;
  };
  lines: BillLine[];
  files: BillFile[]; // attached invoice PDF/image — same document, same round trip
  /** The bill's own job id, read from the document. Lets a caller that only has
   *  a docId (e.g. a bill link with no ?jobId) recover the job to load its
   *  budget/CTC, instead of erroring for want of a query param. "" if unknown. */
  jobId: string;
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
        description: {},
        cost: {},
        quantity: {},
        unitCost: {},
        costCode: { number: {}, name: {} },
        jobCostItem: { id: {} }, // ← the coding target (budget cost item)
      },
    },
    files: {
      $: { size: 20 }, // 20 = how many FILES; the `size` under `url` is pixels
      nodes: { id: {}, name: {}, type: {}, url: {}, imageUrl: { _: "url", $: { size: 2048 } } },
    },
  };
  const rich = {
    document: {
      $: { id: docId },
      id: {},
      name: {},
      status: {},
      cost: {},
      issueDate: {},
      dueDate: {},
      dueDays: {},
      subject: {},
      fromName: {},
      number: {},
      externalId: {},
      qboIsIgnored: {},
      qboDocumentType: {},
      nonRecoverableTax: {},
      nonRecoverableTaxName: {},
      job: { id: {}, name: {}, location: { account: { name: {} } } }, // the bill's own job + customer — lets /api/bill work without ?jobId
      account: { name: {} }, // the actual vendor — see BillDetail.header.vendorName
      ...lineSel,
    },
  };
  const min = {
    document: {
      $: { id: docId },
      id: {},
      name: {},
      status: {},
      cost: {},
      issueDate: {},
      dueDate: {},
      dueDays: {},
      nonRecoverableTax: {},
      nonRecoverableTaxName: {},
      job: { id: {}, name: {}, location: { account: { name: {} } } },
      account: { name: {} },
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
      vendorName: d.account?.name,
      jobName: d.job?.name,
      customerName: d.job?.location?.account?.name,
      number: d.number,
      externalId: d.externalId,
      status: d.status,
      cost: d.cost,
      issueDate: d.issueDate,
      dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : "",
      dueDays: typeof d.dueDays === "number" ? d.dueDays : null,
      qboIsIgnored: d.qboIsIgnored,
      qboDocumentType: d.qboDocumentType ?? null,
      nonRecoverableTax: d.nonRecoverableTax,
      recordsTax: d.nonRecoverableTaxName != null,
    },
    lines: d.costItems?.nodes ?? [],
    files: d.files?.nodes ?? [],
    jobId: d.job?.id ?? "",
  };
}

/**
 * The bill header fields the FINANCIAL JOURNAL records, and nothing else.
 *
 * Deliberately not `getBillDetail`: that pulls 100 cost items and every attached
 * file, and a journal's before-read runs on the critical path of a tap on a
 * phone. This is one small document read — the fields a header write can change,
 * plus the job id so the journal row is filterable by job.
 *
 * Returns `null` on ANY failure. A missing before-value is recorded honestly as
 * `beforeSource: "none"`; it must never stop the write it was going to describe.
 */
export async function getBillJournalSnapshot(
  cfg: PaveConfig,
  docId: string,
): Promise<{
  status?: string;
  issueDate?: string;
  dueDate?: string;
  externalId?: string;
  name?: string;
  cost?: number;
  nonRecoverableTax?: number;
  qboIsIgnored?: boolean;
  qboDocumentType?: string;
  jobId: string;
  /** The vendor account — what picks an Expense's paid-from account. */
  accountId?: string;
  accountName?: string;
} | null> {
  try {
    const r: any = await pave(cfg, {
      document: {
        $: { id: docId },
        id: {},
        status: {},
        issueDate: {},
        dueDate: {},
        externalId: {},
        name: {},
        cost: {},
        nonRecoverableTax: {},
        qboIsIgnored: {},
        qboDocumentType: {},
        job: { id: {} },
        account: { id: {}, name: {} },
      },
    });
    const d = r?.document;
    if (!d) return null;
    return {
      status: d.status ?? undefined,
      issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : undefined,
      dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : undefined,
      externalId: d.externalId ?? undefined,
      name: d.name ?? undefined,
      cost: typeof d.cost === "number" ? d.cost : undefined,
      nonRecoverableTax: typeof d.nonRecoverableTax === "number" ? d.nonRecoverableTax : undefined,
      qboIsIgnored: typeof d.qboIsIgnored === "boolean" ? d.qboIsIgnored : undefined,
      qboDocumentType: d.qboDocumentType ?? undefined,
      jobId: d.job?.id ?? "",
      accountId: d.account?.id ?? undefined,
      accountName: d.account?.name ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * WRITE — set a bill's header flags. `name` is "Bill" | "Expense" (the JT doc
 * name / template), `qboDocumentType` is how it SYNCS to QuickBooks ("bill" vs
 * "purchase" = expense) — changing name alone doesn't change the QBO type, so the
 * Bill/Expense toggle sets both. `qboIsIgnored` controls Push to QuickBooks
 * (ignored = NOT pushed, so Push-to-QB = !qboIsIgnored). Never touches lineItems.
 *
 * A `qboDocumentType` write carries its paid-from account (`expenseAccountId`,
 * default QBO_EXPENSE_ACCOUNT_ID, for "purchase"; none for "bill"), and throws
 * if JobTread does not keep the type — it drops an unusable one without an
 * error. Pass `expenseAccountFor(vendor)` so a Sunset bill pays from Banner.
 */
export async function setBillFields(
  cfg: PaveConfig,
  docId: string,
  fields: { name?: string; qboIsIgnored?: boolean; qboDocumentType?: string },
  opts: { expenseAccountId?: string } = {},
): Promise<{
  saved: { name?: string; qboIsIgnored?: boolean; qboDocumentType?: string };
  accountId: string;
}> {
  const $: Record<string, unknown> = { id: docId, ...fields };
  if (fields.qboDocumentType) {
    $.qboAccountId =
      fields.qboDocumentType === "purchase" ? (opts.expenseAccountId ?? QBO_EXPENSE_ACCOUNT_ID) : null;
  }
  const r = await pave(cfg, {
    updateDocument: {
      $,
      document: {
        $: { id: docId },
        id: {},
        name: {},
        qboIsIgnored: {},
        qboDocumentType: {},
        account: { id: {} },
      },
    },
  });
  const d = r?.updateDocument?.document ?? {};
  if (fields.qboDocumentType && (d.qboDocumentType ?? "bill") !== fields.qboDocumentType) {
    throw new Error(`JobTread kept Push as ${d.qboDocumentType === "purchase" ? "Expense" : "Bill"}.`);
  }
  return {
    saved: { name: d.name, qboIsIgnored: d.qboIsIgnored, qboDocumentType: d.qboDocumentType },
    accountId: String(d.account?.id ?? ""),
  };
}

export interface BillFile {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  /** JobTread's own FLAT RENDER of the file — page 1 as a JPEG, served from the
   *  same CDN with no viewer around it (probe-confirmed 2026-09-03: a PDF's
   *  `url({size})` answers `content-type: image/jpeg`, `access-control-allow-
   *  origin: *`). It exists so a scan can be shown as an `<img>` in the page
   *  flow instead of an `<iframe>`, which hands the browser's PDF viewer its
   *  own scrollbox and swallows the wheel. Null for anything JobTread cannot
   *  rasterise, which is the exact signal to fall back to a link. */
  imageUrl?: string | null;
}

/** Files attached to a bill (the invoice PDF/image). Defensive — [] on any error. */
export async function getBillFiles(cfg: PaveConfig, docId: string): Promise<BillFile[]> {
  try {
    const r = await pave(cfg, {
      document: {
        $: { id: docId },
        id: {},
        files: {
          $: { size: 20 }, // 20 = how many FILES; the `size` under `url` is pixels
          nodes: { id: {}, name: {}, type: {}, url: {}, imageUrl: { _: "url", $: { size: 2048 } } },
        },
      },
    });
    return r?.document?.files?.nodes ?? [];
  } catch {
    return [];
  }
}

/** One file on a job's Files tab — what the Office dashboard's browser lists. */
export interface JobFile {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Path inside the job, "/"-separated; null at the top level. */
  folder: string | null;
  createdAt: string;
  url: string | null;
  /** JobTread's resized JPEG of an image (a PDF's page 1) — ~512px for a grid tile. */
  thumbUrl: string | null;
  /** The same at ~2048px, for the full-screen view. Far lighter than a phone photo's original. */
  imageUrl: string | null;
  /** Set when the file came in on a bill or other document, not uploaded to the job. */
  document: { id: string } | null;
}

/**
 * Every file on a job, newest first. `job.files` includes the files attached to
 * the job's documents (bill scans) as well as the ones uploaded to it; the
 * `document` link tells them apart. Throws — the page shows the error.
 */
export async function getJobFiles(cfg: PaveConfig, jobId: string): Promise<JobFile[]> {
  const rows = await pageAll<JobFile>(cfg, {
    label: "job.files",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        files: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            type: {},
            size: {},
            folder: {},
            createdAt: {},
            url: {},
            thumbUrl: { _: "url", $: { size: 400 } },
            imageUrl: { _: "url", $: { size: 2048 } },
            document: { id: {} },
          },
        },
      },
    }),
    pick: (r) => r?.job?.files,
  });
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One sheet on a job's Plans tab: a page of an uploaded drawing set. */
export interface JobPlan {
  id: string;
  name: string;
  /** 1-based page of `file` this sheet is. */
  page: number;
  createdAt: string;
  file: { id: string; name: string; type: string; url: string | null; imageUrl: string | null };
}

/**
 * Every sheet on a job's Plans tab, in upload order (JobTread splits each
 * drawing set into one plan per page). `imageUrl` is the file's rasterised
 * page 1; add `&page=N` for the sheet's own page (InvoiceViewer's `pageSrc`).
 * Read-only. Fields confirmed by a live read 2026-11-01.
 */
export async function getJobPlans(cfg: PaveConfig, jobId: string): Promise<JobPlan[]> {
  const rows = await pageAll<JobPlan>(cfg, {
    label: "job.plans",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        plans: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            page: {},
            createdAt: {},
            file: {
              id: {},
              name: {},
              type: {},
              url: {},
              imageUrl: { _: "url", $: { size: 800 } },
            },
          },
        },
      },
    }),
    pick: (r) => r?.job?.plans,
  });
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * One JobTread file by its id — the name, type, size and a fresh download link.
 * AscentBot's file reader fetches the bytes from that link. Read-only.
 * Fields confirmed by a live read 2026-10-29.
 */
export async function getFileById(
  cfg: PaveConfig,
  fileId: string,
): Promise<{ id: string; name: string; type: string; size: number; url: string } | null> {
  const r = await pave(cfg, { file: { $: { id: fileId }, id: {}, name: {}, type: {}, size: {}, url: {} } });
  const f = r?.file;
  if (!f?.id) return null;
  return {
    id: String(f.id),
    name: String(f.name ?? ""),
    type: String(f.type ?? ""),
    size: Number(f.size) || 0,
    url: String(f.url ?? ""),
  };
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
 * WRITE — set a bill's dueDate (JobTread calls it "Payment Due"), the date the
 * VENDOR's invoice is due. Not the billing month: that is `issueDate`.
 *
 * `dueDays` is nulled in the same write on purpose. A JobTread document carries
 * EITHER an explicit `dueDate` or `dueDays` net terms, never both, and a bill
 * still on net terms rejects a bare dueDate (probe-confirmed on the Apps Script
 * side — see the date-repair note in ascent-appscript/Diagnostics.js). Passing an
 * empty string clears the due date and puts the bill back on net-30, which is
 * what ingestion gives a bill whose invoice printed no due date.
 *
 * Never touches lineItems (updateDocument with lineItems wipes cost items —
 * CLAUDE.md).
 */
export async function setBillDueDate(
  cfg: PaveConfig,
  docId: string,
  dueDate: string,
): Promise<{ dueDate: string; dueDays: number | null }> {
  const args = dueDate
    ? { id: docId, dueDate, dueDays: null }
    : { id: docId, dueDate: null, dueDays: 30 };
  const r = await pave(cfg, {
    updateDocument: {
      $: args,
      document: { $: { id: docId }, id: {}, dueDate: {}, dueDays: {} },
    },
  });
  const d = r?.updateDocument?.document ?? {};
  return {
    dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : "",
    dueDays: typeof d.dueDays === "number" ? d.dueDays : null,
  };
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
 * WRITE — set a bill's sales tax, which is a LINE (88 80 00), not a field.
 *
 * Reads the bill, then does the one thing that is needed: update the tax line,
 * create it, or delete it when the tax drops to zero. Also clears any legacy
 * `nonRecoverableTax` the bill still carries, so a bill touched here comes away
 * fully on the current model instead of counting its tax twice.
 *
 * `salesTaxJobCostItemId` codes the line to the job's 88 80 00 budget leaf. Omit
 * it and the line is left uncoded rather than routed to a fallback code — sales
 * tax posted to the wrong QuickBooks account is worse than a visible gap.
 *
 * Never sends `lineItems` on updateDocument (that wipes every cost item —
 * CLAUDE.md); line work goes through createCostItem/updateCostItem/deleteCostItem.
 *
 * @return the tax the bill carries afterwards.
 */
export async function setBillTax(
  cfg: PaveConfig,
  docId: string,
  taxAmount: number,
  salesTaxJobCostItemId?: string,
): Promise<number> {
  const amount = Math.round((Number(taxAmount) || 0) * 100) / 100;

  const read = await pave(cfg, {
    document: {
      $: { id: docId },
      id: {},
      nonRecoverableTax: {},
      nonRecoverableTaxName: {},
      costItems: {
        $: { size: 100 },
        nodes: { id: {}, name: {}, description: {}, cost: {}, costCode: { number: {} } },
      },
    },
  });
  const doc = read?.document ?? {};
  const existing: BillLine[] = doc.costItems?.nodes ?? [];
  const taxLine = existing.find((l) => isSalesTaxLine(l)) ?? null;

  if (amount > 0) {
    const $: Record<string, unknown> = {
      name: SALES_TAX_LINE_NAME,
      description: SALES_TAX_CSI,
      unitCost: amount,
      quantity: 1,
      isTaxable: false,
      customFieldValues: [{ customFieldId: CF_COST_CODES, value: SALES_TAX_CSI }],
    };
    if (salesTaxJobCostItemId) $.jobCostItemId = salesTaxJobCostItemId;
    if (taxLine) {
      await pave(cfg, {
        updateCostItem: {
          $: { ...$, id: taxLine.id },
          costItem: { $: { id: taxLine.id }, id: {} },
        },
      });
    } else {
      await pave(cfg, {
        createCostItem: { $: { ...$, documentId: docId }, createdCostItem: { id: {} } },
      });
    }
  } else if (taxLine) {
    await pave(cfg, { deleteCostItem: { $: { id: taxLine.id } } });
  }

  // Clear the legacy field AND JobTread's "Record Tax" toggle. Left set, the
  // field's amount would keep spreading across the cost items on top of the line
  // just written. Left toggled ON with the amount at 0, the bill still shows a
  // document tax row anyone can type into — which is how a bill ends up taxed
  // twice, once on its 88 80 00 line and once on the document.
  //
  // The toggle IS `nonRecoverableTaxName`: a name means the row shows, null means
  // it is off. Nothing else stores it (confirmed live 2026-09-08 — every bill
  // created since the template default changed reads null, every older one "Tax").
  if ((Number(doc.nonRecoverableTax) || 0) !== 0 || doc.nonRecoverableTaxName != null) {
    await pave(cfg, {
      updateDocument: {
        $: { id: docId, nonRecoverableTax: 0, nonRecoverableTaxName: null },
        document: { $: { id: docId }, id: {} },
      },
    });
  }

  return amount;
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
          $: {
            where: {
              and: [
                ["type", "vendorBill"],
                ["status", "draft"],
              ],
            },
          },
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
  /**
   * `costType.isTimeTrackable` — JobTread REFUSES a time entry on a cost item
   * whose cost type isn't time-trackable ("Cannot create time entry for cost
   * item with a cost type that is not able to be time tracked."). One cost code
   * routinely carries both a Materials leaf and a Labor leaf, so labor has to
   * pick the time-trackable one, not the first one.
   */
  timeTrackable?: boolean;
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
/**
 * Budget leaves → two `costCode → costItemId` maps: every leaf (first wins), and
 * only the TIME-TRACKABLE leaves (first wins). Bill coding uses `byCode`; a time
 * entry must use `timeTrackable`, because JobTread rejects a time entry on a
 * Materials/Subcontractor/Other leaf and one code routinely has both kinds.
 */
export function budgetCodeMaps(items: BudgetItem[]): {
  byCode: Record<string, string>;
  timeTrackable: Record<string, string>;
} {
  const byCode: Record<string, string> = {};
  const timeTrackable: Record<string, string> = {};
  for (const b of items) {
    if (!byCode[b.number]) byCode[b.number] = b.id;
    if (b.timeTrackable && !timeTrackable[b.number]) timeTrackable[b.number] = b.id;
  }
  return { byCode, timeTrackable };
}

export function getJobBudget(cfg: PaveConfig, jobId: string): Promise<BudgetItem[]> {
  return cachedRef(_jobCostKey("budget", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getJobBudgetUncached(cfg, jobId),
  );
}

/**
 * The job's leaves that a TIME ENTRY may be coded to.
 *
 * A cost CODE is not the unit JobTread gates on — a cost ITEM is, through its
 * cost type. One code routinely carries a Materials leaf and a Labor leaf, and
 * only the second will take an hour. Offering the whole budget therefore offers
 * codes that are refused at write time, after the employee has gone home.
 *
 * WHEN NO LEAF LOOKS TRACKABLE, EVERY LEAF IS RETURNED. "None" almost always
 * means the flag could not be read (a grant without the permission, a field
 * JobTread stopped returning), not that a live job has no labor line — and an
 * empty dropdown stops a crew logging time at all, which is worse than the
 * refusal it would prevent. `filtered` says which of the two answers this is,
 * so a caller can word itself honestly.
 */
export async function getTimeTrackableLeaves(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ items: BudgetItem[]; filtered: boolean }> {
  return timeTrackableLeaves(await getJobBudget(cfg, jobId));
}

/** The decision `getTimeTrackableLeaves` makes, without the fetch. Unit-tested. */
export function timeTrackableLeaves(all: BudgetItem[]): {
  items: BudgetItem[];
  filtered: boolean;
} {
  const trackable = all.filter((b) => b.timeTrackable);
  return trackable.length ? { items: trackable, filtered: true } : { items: all, filtered: false };
}

/** Where a time entry's cost code ended up, and whether it had to move. */
export interface TimeLeafResolution {
  /** The leaf to use. "" when the job carries no time-trackable leaf for the code. */
  costItemId: string;
  /** True when this is NOT the leaf that was asked for. */
  moved: boolean;
  /** The cost code the answer sits under, for a message. */
  number: string;
}

/**
 * Point a time entry at a leaf JobTread will accept, under the SAME cost code.
 *
 * The repair for an entry coded to the wrong row: "01 51 20" may have a Labor
 * leaf and a Materials leaf, and an entry on the Materials one is refused. The
 * code the employee picked is right; only the row under it is wrong, so this
 * moves the entry within the code and never across codes — guessing a different
 * code would put someone's hours on the wrong budget line.
 *
 * Used by the Time Sync retry, NOT by the live logging path: a re-code is a
 * repair of a known-broken record, and the picker (`getTimeTrackableLeaves`) is
 * what stops the bad pick happening in the first place.
 */
export async function resolveTimeTrackableLeaf(
  cfg: PaveConfig,
  jobId: string,
  costItemId: string,
  costCode = "",
): Promise<TimeLeafResolution> {
  return pickTimeLeaf(await getJobBudget(cfg, jobId), costItemId, costCode);
}

/** The decision `resolveTimeTrackableLeaf` makes, without the fetch. Unit-tested. */
export function pickTimeLeaf(
  all: BudgetItem[],
  costItemId: string,
  costCode = "",
): TimeLeafResolution {
  const given = all.find((b) => b.id === costItemId);
  const number = (given?.number ?? costCode).trim();

  // Nothing on this job reads as trackable — see getTimeTrackableLeaves. We
  // cannot tell a wrong line from an unreadable flag, so change nothing.
  if (!all.some((b) => b.timeTrackable)) return { costItemId, moved: false, number };

  if (given?.timeTrackable) return { costItemId, moved: false, number };

  const { timeTrackable } = budgetCodeMaps(all);
  const hit = number ? timeTrackable[number] : undefined;
  return hit
    ? { costItemId: hit, moved: hit !== costItemId, number }
    : { costItemId: "", moved: false, number };
}

/**
 * The job budget's 88 80 00 leaf — where a bill's sales-tax line is coded.
 *
 * REFRESH-ON-MISS, like the Apps Script budget map: a miss re-reads the budget
 * live before giving up, because the common miss is a leaf the owner added to
 * the budget inside the cache TTL. Returns undefined when the job genuinely has
 * no such leaf; callers then push the tax line UNCODED rather than routing it to
 * a fallback code, which would post sales tax to the wrong QuickBooks account.
 */
export async function getSalesTaxLeafId(
  cfg: PaveConfig,
  jobId: string,
): Promise<string | undefined> {
  if (!jobId) return undefined;
  const find = (items: BudgetItem[]) => items.find((b) => b.number === SALES_TAX_CSI)?.id;
  const hit = find(await getJobBudget(cfg, jobId));
  if (hit) return hit;
  try {
    return find(await _getJobBudgetUncached(cfg, jobId));
  } catch {
    return undefined;
  }
}
/**
 * A month's sales tax PER BILL — the 88 80 00 line on each vendor bill, keyed by
 * document id. Pass `jobId` to narrow to one job.
 *
 * WHY IT EXISTS. A bill's JobTread `cost` includes its sales-tax line, and every
 * "to be invoiced" figure is a sum of bill costs. Tax paid to a vendor is not
 * client-billable (src/lib/salesTax.ts) — it is recorded only so QuickBooks gets
 * a sales-tax figure — so those totals have to net it out. A document-level sum
 * cannot see the line, so the lines are read directly: ONE paged costItems
 * query, filtered server-side to the code, the bill type and the month.
 *
 * ponytail: matches the CODE only, not the legacy line name. A pre-2026-09-05
 * bill carries its tax in `nonRecoverableTax`, which JobTread spreads across the
 * cost items — there is no line to subtract there, so nothing is lost.
 */
export async function getSalesTaxByDoc(
  cfg: PaveConfig,
  year: number,
  month: number,
  jobId?: string,
): Promise<Map<string, number>> {
  return codeCostByDoc(cfg, SALES_TAX_CSI, year, month, jobId);
}

/**
 * Each vendor bill's warranty-work (88 90 00) lines, summed per document id —
 * the same read as getSalesTaxByDoc, for the same reason: warranty is Ascent's
 * cost, never billed to the client, so every "to be invoiced" figure nets it
 * out (src/lib/warranty.ts).
 */
export async function getWarrantyByDoc(
  cfg: PaveConfig,
  year: number,
  month: number,
  jobId?: string,
): Promise<Map<string, number>> {
  return codeCostByDoc(cfg, WARRANTY_CSI, year, month, jobId);
}

/** One cost code's vendor-bill lines in a billing month, summed per document. */
export async function codeCostByDoc(
  cfg: PaveConfig,
  code: string,
  year: number,
  month: number,
  jobId?: string,
): Promise<Map<string, number>> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const and: unknown[] = [
    [["costCode", "number"], "=", code],
    [["document", "type"], "=", "vendorBill"],
    [["document", "issueDate"], ">=", first],
    [["document", "issueDate"], "<=", last],
  ];
  if (jobId) and.push([["document", "job", "id"], "=", jobId]);

  const out = new Map<string, number>();
  await pageEach<any>(
    cfg,
    {
      label: `organization.costItems (${code} by document)`,
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          costItems: {
            $: { where: { and }, ...args },
            nextPage: {},
            nodes: { cost: {}, document: { id: {} } },
          },
        },
      }),
      pick: (r) => r?.organization?.costItems,
    },
    (rows) => {
      for (const n of rows) {
        const id = n?.document?.id;
        if (!id) continue;
        out.set(id, Math.round(((out.get(id) ?? 0) + (Number(n.cost) || 0)) * 100) / 100);
      }
    },
  );
  return out;
}

export async function _getJobBudgetUncached(cfg: PaveConfig, jobId: string): Promise<BudgetItem[]> {
  const walk = async (where?: unknown): Promise<BudgetItem[]> => {
    const items: BudgetItem[] = [];
    await pageEach<any>(
      cfg,
      {
        label: "job.costItems (budget leaves)",
        query: (args) => ({
          job: {
            $: { id: jobId },
            id: {},
            costItems: {
              $: { ...(where ? { where } : {}), ...args },
              nextPage: {},
              nodes: {
                id: {},
                name: {},
                cost: {},
                document: { id: {} },
                costCode: { number: {}, name: {}, parentCostCode: { name: {} } },
                costType: { name: {}, isTimeTrackable: {} },
              },
            },
          },
        }),
        pick: (r) => r?.job?.costItems,
      },
      (rows) => {
        for (const n of rows) {
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
            timeTrackable: n?.costType?.isTimeTrackable === true,
            cost: typeof n?.cost === "number" ? n.cost : undefined,
            division: n?.costCode?.parentCostCode?.name ?? undefined,
          });
        }
      },
    );
    return items;
  };
  let items: BudgetItem[];
  try {
    items = await walk([["document", "id"], null]);
  } catch (e) {
    // Filter rejected — fall back to scanning every cost item. Too much data is
    // not a rejected filter, and the unfiltered walk would only overflow harder.
    if (e instanceof PaveTooManyPagesError) throw e;
    items = await walk();
  }
  // stable sort by code for the dropdown
  return items.sort((a, b) => a.number.localeCompare(b.number));
}

export interface CostToComplete {
  budget: number; // Σ approved customer-order cost for the code = Budgeted Cost (contract + change orders)
  actual: number; // Σ approved+pending vendorBill cost for the code (spent/committed)
  remaining: number; // budget − actual (negative = over budget)
}

export const CTC_BUDGET_WHERE = {
  and: [
    [["document", "type"], "customerOrder"],
    [["document", "status"], "approved"],
    [["document", "includeInBudget"], true],
  ],
};
export const CTC_ACTUAL_WHERE = {
  and: [
    [["document", "type"], "vendorBill"],
    { in: [{ field: ["document", "status"] }, [{ value: "approved" }, { value: "pending" }]] },
  ],
};

/** Σ cost per cost-code number over the cost items matching `where`, summed by JobTread. */
export async function _sumCostByCostCode(
  cfg: PaveConfig,
  jobId: string,
  where: unknown,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await pageEach<any>(
    cfg,
    {
      label: "job.costItems grouped by cost code",
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          costItems: {
            $: {
              // pages over GROUPS (one per cost code), not raw cost items
              where,
              group: { by: [["costCode", "number"]], aggs: { total: { sum: "cost" } } },
              ...args,
            },
            withValues: {},
            nextPage: {},
          },
        },
      }),
      pick: (r) => r?.job?.costItems,
    },
    (rows) => {
      for (const row of rows) {
        const code = row?.costCode?.number?.toString().trim();
        if (!code) continue;
        out[code] = (out[code] ?? 0) + (row.total ?? 0);
      }
    },
  );
  return out;
}

/**
 * The pre-2026-08 way: one full paginated scan of job.costItems, bucketed here.
 * Kept only as the safety net for `getCostToComplete` — same arithmetic, same
 * result, just 7–13 round trips instead of 2.
 */
export async function _costToCompleteByFullWalk(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ budget: Record<string, number>; actual: Record<string, number> }> {
  const nodes = await pageAll<any>(cfg, {
    label: "job.costItems (full cost-to-complete walk)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        costItems: {
          $: args,
          nextPage: {},
          nodes: {
            cost: {},
            costCode: { number: {} },
            document: { type: {}, status: {}, includeInBudget: {} },
          },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });

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
export async function _getCostToCompleteUncached(
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
