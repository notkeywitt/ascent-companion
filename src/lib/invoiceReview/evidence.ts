/**
 * Gathering the evidence a month's client-invoice review is judged on.
 *
 * This module does ALL the fetching and NONE of the judging — checks.ts is pure
 * and never touches the network. Keeping the split sharp is what lets the money
 * arithmetic be unit-tested against fixtures instead of against JobTread.
 *
 * ## What "this month's invoices" means
 *
 * Not "customerInvoice documents whose issueDate falls in the month" — that
 * definition would make the billing-period check vacuous, since every invoice
 * would be in the month by construction. The office's definition is the useful
 * one: the invoices that THIS MONTH'S BILLS landed on. So the roster is built
 * bills-first (`getMonthlyInvoiceJobs`), and each job's live invoices come from
 * `getInvoiceReconciliation`, which already resolves JobTread's denied-and-
 * re-issued invoice chain. An invoice reached that way but dated into another
 * month is then a real finding.
 *
 * ## The 413 rule
 *
 * `costItems` must never be nested inside a paged `documents` connection — the
 * Pave API answers HTTP 413 regardless of page size. Invoice headers are paged
 * at the job level; each invoice's LINES are fetched in a second phase, one
 * `document(id).costItems` call each. `referencedDocuments` is fine nested at
 * size 25, which is the size used here (the same one getUninvoicedBills uses).
 *
 * ## Drive
 *
 * The Assistant has no Drive grant, so the backup listing goes through the Apps
 * Script bridge (`listBillingFolder`, in ascent-appscript/ClientInvoiceReview.js).
 * A Drive failure is collected as a WARNING and the review continues — a review
 * that renders the math findings is worth more than one that errors out because
 * the script deployment was slow.
 */
import { callAppsScript } from "@/lib/appsScript";
import {
  getInvoiceReconciliation,
  getMonthlyInvoiceJobs,
  pave,
  type PaveConfig,
} from "@/lib/jobtread";

import type {
  BackupFile,
  BillRef,
  InvoiceEvidence,
  InvoiceLine,
  JobEvidence,
  MonthEvidence,
} from "./types";

/** How many jobs are gathered at once. Each job costs ~5 Pave calls plus one
 *  Apps Script round trip, so this trades the route's wall clock against
 *  JobTread's patience. Matches the digest's own per-job sweep. */
const CONCURRENCY = 4;

/** Guard on every cursor loop, so a pagination bug can't spin forever. */
const PAGE_GUARD = 100;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Bounded-concurrency map, preserving input order. (The digest's costVsInvoice
 *  check carries its own private copy; this one is scoped to the review.) */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * The Drive folder a billing month's backup is filed in.
 *
 * The FOLDER month is the billing month + 1 (June's costs are billed in July),
 * and December billing rolls the year root forward. Mirrors `_civFolderNames`
 * in ascent-appscript/ClientInvoiceReview.js and `resolveBillingFolder` in
 * Ingestion.js — all three must agree, so change them together.
 */
export function billingFolderRoot(year: number, month: number): string {
  const billIdx = month - 1;
  const folderIdx = (billIdx + 1) % 12;
  const folderYear = billIdx === 11 ? year + 1 : year;
  const mm = String(folderIdx + 1).padStart(2, "0");
  const yy = String(folderYear).slice(-2);
  return `/${folderYear} Invoicing/${mm} ${MONTH_NAMES[folderIdx]} ${yy} (${MONTH_NAMES[billIdx]} Billing)/`;
}

/** "2026-07" → { year: 2026, month: 7 }, or null when it isn't a month. */
export function parseYm(ym: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

/**
 * Every finalized vendor bill a job issued in the billing month, with the
 * client invoices it sits on.
 *
 * `invoiced` follows the convention the rest of the app already uses (see
 * getMonthlyInvoiceJobs): a bill is "billed to the client" when it references
 * ANY customerInvoice, whatever that invoice's status. `invoiceIds` is narrower
 * — only the LIVE invoices the bill points at directly. JobTread's re-issue
 * pattern means a bill can sit on a live invoice while only referencing the
 * denied original it replaced, so `invoiceIds` can be empty for a bill that is
 * genuinely invoiced. That is deliberate: the duplicate-billing check reads
 * `invoiceIds`, and under-reporting a duplicate is far safer than inventing one.
 */
async function loadMonthBills(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
  liveInvoiceIds: Set<string>,
): Promise<BillRef[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const bills: BillRef[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r: any = await pave(cfg, {
      job: {
        $: { id: jobId },
        documents: {
          $: {
            where: {
              and: [["type", "vendorBill"], ["status", "in", ["pending", "approved"]]],
            },
            // 25, not 100: referencedDocuments nested in a paged documents
            // connection answers 413 at larger sizes (confirmed behavior).
            size: 25,
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: {
            id: {},
            cost: {},
            issueDate: {},
            status: {},
            externalId: {},
            number: {},
            fromName: {},
            account: { name: {} },
            referencedDocuments: { nodes: { id: {}, type: {} } },
          },
        },
      },
    });
    for (const b of (r?.job?.documents?.nodes ?? []) as any[]) {
      const issued = String(b.issueDate ?? "").slice(0, 10);
      if (!issued || issued < first || issued > last) continue;
      const refs = (b.referencedDocuments?.nodes ?? []) as any[];
      const invoiceRefs = refs.filter((n) => n?.type === "customerInvoice" && n?.id);
      bills.push({
        id: b.id,
        vendor: b.account?.name ?? b.fromName ?? "",
        label: String(b.externalId || b.number || b.account?.name || b.fromName || b.id),
        cost: b.cost ?? 0,
        status: b.status ?? "",
        invoiced: invoiceRefs.length > 0,
        invoiceIds: Array.from(
          new Set(invoiceRefs.map((n) => n.id as string).filter((id) => liveInvoiceIds.has(id))),
        ),
      });
    }
    page = r?.job?.documents?.nextPage || undefined;
  } while (page && ++guard < PAGE_GUARD);

  return bills;
}

/** One client invoice's header and every line on it. */
async function loadInvoice(
  cfg: PaveConfig,
  jobId: string,
  invoiceId: string,
): Promise<InvoiceEvidence> {
  const h: any = await pave(cfg, {
    document: {
      $: { id: invoiceId },
      id: {}, number: {}, name: {}, status: {},
      issueDate: {}, dueDate: {},
      cost: {}, price: {}, priceWithTax: {}, tax: {}, taxRate: {},
      amountPaid: {}, balance: {},
      referencedDocuments: { $: { size: 100 }, nodes: { id: {}, type: {} } },
    },
  });
  const d = h?.document ?? {};

  // Phase 2 — the lines. Nesting this inside the header query above would be
  // fine (the header isn't paged), but keeping it separate means a job with a
  // 300-line invoice pages cleanly instead of hitting the 100-node cap.
  const lines: InvoiceLine[] = [];
  let page: string | undefined;
  let guard = 0;
  do {
    const r: any = await pave(cfg, {
      document: {
        $: { id: invoiceId },
        costItems: {
          $: { size: 100, ...(page ? { page } : {}) },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            unitPrice: {},
            price: {},
            isTaxable: {},
            costCode: { number: {}, name: {} },
          },
        },
      },
    });
    for (const l of (r?.document?.costItems?.nodes ?? []) as any[]) {
      lines.push({
        id: l.id,
        name: l.name ?? "",
        description: l.description ?? "",
        code: l.costCode?.number ?? "",
        codeName: l.costCode?.name ?? "",
        quantity: l.quantity ?? 0,
        unitPrice: l.unitPrice ?? 0,
        price: l.price ?? 0,
        isTaxable: l.isTaxable !== false,
      });
    }
    page = r?.document?.costItems?.nextPage || undefined;
  } while (page && ++guard < PAGE_GUARD);

  return {
    id: invoiceId,
    number: d.number == null ? "" : String(d.number),
    name: d.name ?? "",
    status: d.status ?? "",
    issueDate: String(d.issueDate ?? "").slice(0, 10),
    dueDate: String(d.dueDate ?? "").slice(0, 10),
    cost: d.cost ?? 0,
    price: d.price ?? 0,
    priceWithTax: d.priceWithTax ?? 0,
    tax: d.tax ?? 0,
    taxRate: d.taxRate ?? 0,
    amountPaid: d.amountPaid ?? 0,
    balance: d.balance ?? 0,
    lines,
    billIds: ((d.referencedDocuments?.nodes ?? []) as any[])
      .filter((n) => n?.type === "vendorBill" && n?.id)
      .map((n) => n.id as string),
    jtUrl: `https://app.jobtread.com/jobs/${encodeURIComponent(jobId)}/documents/${encodeURIComponent(invoiceId)}`,
  };
}

/** The backup PDFs filed for one job in one billing month, via Apps Script. */
async function loadFolder(
  year: number,
  month: number,
  customer: string,
  job: string,
): Promise<{ folder: JobEvidence["folder"]; warning?: string }> {
  const r = await callAppsScript<{
    ok?: boolean;
    error?: string;
    path?: string;
    found?: boolean;
    folderId?: string;
    files?: BackupFile[];
    truncated?: boolean;
    missingAt?: string;
  }>({ action: "listBillingFolder", month, year, customer, job });

  if (r.error) return { folder: null, warning: `Drive listing failed for ${customer}: ${r.error}` };
  const d = r.data ?? {};
  if (d.ok === false) {
    return { folder: null, warning: `Drive listing failed for ${customer}: ${d.error ?? "unknown"}` };
  }
  return {
    folder: {
      path: d.path ?? "",
      found: d.found === true,
      folderId: d.folderId ?? "",
      files: Array.isArray(d.files) ? d.files : [],
      truncated: d.truncated === true,
      missingAt: d.missingAt,
    },
  };
}

/**
 * Everything the review needs for one billing month.
 *
 * Per-job failures are collected as warnings rather than thrown: one job whose
 * reconciliation errors out must not cost the office the other eleven.
 */
export async function loadMonthEvidence(
  cfg: PaveConfig,
  year: number,
  month: number,
): Promise<MonthEvidence> {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const warnings: string[] = [];

  // The roster: every job with bills in the billing month, invoiced or not,
  // drafts included — a job whose whole month is still in draft is precisely
  // the one the review needs to shout about.
  const roster = await getMonthlyInvoiceJobs(cfg, year, month, true, true);

  const jobs = await mapWithLimit(roster, CONCURRENCY, async (row): Promise<JobEvidence> => {
    const shell: JobEvidence = {
      jobId: row.jobId,
      jobName: row.jobName,
      customerName: row.customerName,
      invoices: [],
      bills: [],
      folder: null,
      uninvoicedBillsCost: 0,
      uninvoicedTimeCost: 0,
      draftBillsCost: 0,
      draftBillCount: 0,
    };

    let liveIds = new Set<string>();
    try {
      const recon = await getInvoiceReconciliation(cfg, row.jobId, year, month);
      liveIds = new Set(recon.invoices.map((i) => i.id));
      shell.uninvoicedBillsCost = recon.uninvoicedBillsCost;
      shell.uninvoicedTimeCost = recon.uninvoicedTimeCost;
      shell.draftBillsCost = recon.draftBillsCost;
      shell.draftBillCount = recon.draftBillCount;
    } catch (e) {
      warnings.push(
        `${row.jobName || row.jobId}: could not reconcile the month — ` +
          `${e instanceof Error ? e.message : "unknown error"}`,
      );
    }

    const [bills, invoices, folder] = await Promise.all([
      loadMonthBills(cfg, row.jobId, year, month, liveIds).catch((e) => {
        warnings.push(
          `${row.jobName || row.jobId}: could not read the month's bills — ` +
            `${e instanceof Error ? e.message : "unknown error"}`,
        );
        return [] as BillRef[];
      }),
      mapWithLimit(Array.from(liveIds), 2, (id) =>
        loadInvoice(cfg, row.jobId, id).catch((e) => {
          warnings.push(
            `${row.jobName || row.jobId}: could not read invoice ${id} — ` +
              `${e instanceof Error ? e.message : "unknown error"}`,
          );
          return null;
        }),
      ),
      loadFolder(year, month, row.customerName, row.jobName),
    ]);

    if (folder.warning) warnings.push(folder.warning);
    shell.bills = bills;
    shell.invoices = invoices.filter((i): i is InvoiceEvidence => i !== null);
    shell.folder = folder.folder;
    return shell;
  });

  return {
    ym,
    year,
    month,
    monthLabel,
    folderRoot: billingFolderRoot(year, month),
    // Customer first, so the review reads the way the office works through it.
    jobs: jobs.sort((a, b) =>
      (a.customerName || a.jobName).localeCompare(b.customerName || b.jobName, undefined, {
        sensitivity: "base",
      }),
    ),
    warnings,
  };
}
