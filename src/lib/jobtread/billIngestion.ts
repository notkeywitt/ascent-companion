// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { isSalesTaxLine, SALES_TAX_LINE_NAME, SALES_TAX_CSI } from "@/lib/salesTax";
import { cachedRef, clearJobCostCaches, pageAll, pageEach, pave, type PaveConfig } from "./core";
import { _getJobBudgetUncached, type BudgetItem, getJobBudget, setBillTax } from "./codingQueue";
import { getJobs } from "./jobCostDetail";
import { createLine, deleteLine } from "./homeJobBoard";
import { isSunsetStatementBill, resolveCostCodeId } from "./sunsetStatements";
// ---------------------------------------------------------------------------
// BILL INGESTION  (roadmap D — the extraction engine's JobTread write path, ported
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
  /** Sales tax printed on the invoice. Becomes its own 88 80 00 cost item. */
  taxAmount: number;
  /**
   * The job budget's 88 80 00 leaf, for coding the tax line. Omit and the tax
   * line lands UNCODED — deliberate: better a visible uncoded line than sales
   * tax routed to a fallback code and posted to the wrong QuickBooks account.
   */
  salesTaxJobCostItemId?: string;
  jobLocationName?: string;
  jobLocationAddress?: string;
  pushToQuickBooks?: boolean; // default true (qboIsIgnored = !push)
  /** Default "Bill". An "Expense" is already paid: same vendorBill document, named
   *  "Expense", due the day it is issued (no payment terms) — the appscript push
   *  does the same. The bill page then offers "Record payment" instead of approve. */
  billType?: BillType;
  /** The document name, when it is not `billType` — "Credit" for a Sunset
   *  credit (JobTread's Credit template; no terms, so due on issue). Push as
   *  stays "bill": JobTread files a negative bill as a vendor credit itself. */
  docName?: string;
  lines: NewBillLine[];
}

/**
 * A vendorBill is a Bill (paid later, on terms) or an Expense (already paid).
 * Two JobTread fields carry it and every write here sets BOTH:
 *   - `name` "Bill" | "Expense" — the document's label, and what the appscript
 *     sheet mirror reads;
 *   - `qboDocumentType` "bill" | "purchase" — QuickBooks' "Push as Bill" / "Push
 *     as Expense", the one that decides what QuickBooks records.
 * Someone can flip "Push as" in JobTread alone, so a read trusts either.
 */
export type BillType = "Bill" | "Expense";

export const qboDocumentTypeFor = (t: BillType) => (t === "Expense" ? "purchase" : "bill");

/**
 * The QuickBooks "paid from" account a Push as Expense is written with —
 * Capital One Sparks (owner, 2026-09-29). JobTread needs one: sent without it,
 * "purchase" is silently kept as "bill" (confirmed live 2026-09-29 — every
 * Push as Expense document carries an account, every Bill carries none). The
 * account list is `organization.qboIntegration.accounts`.
 */
export const QBO_EXPENSE_ACCOUNT_ID = "271";

/**
 * Sunset Builders Supply is paid in bulk off its monthly statement, from the
 * bank — so a Sunset Expense is paid from "Checking - Banner Bank" (owner,
 * 2026-10-23), never the card above. Same id as
 * CONFIG.JOBTREAD.QBO_SUNSET_EXPENSE_ACCOUNT_ID in ascent-appscript; keep the
 * two in sync.
 */
export const QBO_SUNSET_EXPENSE_ACCOUNT_ID = "56";

/** Sunset Builders Supply, by its JT account id when the env names it, else by name. */
export function isSunsetVendor(v: { id?: string | null; name?: string | null }): boolean {
  const sunsetId = (process.env.JT_SUNSET_VENDOR_ID ?? "").trim();
  return (sunsetId !== "" && v.id === sunsetId) || /sunset builders/i.test(v.name ?? "");
}

/** The QuickBooks paid-from account for this vendor's Expenses. */
export function expenseAccountFor(v: { id?: string | null; name?: string | null }): string {
  return isSunsetVendor(v) ? QBO_SUNSET_EXPENSE_ACCOUNT_ID : QBO_EXPENSE_ACCOUNT_ID;
}

/**
 * What a Sunset vendorBill should be: an "Expense" paid from Banner Bank, or —
 * for a credit (negative cost) — a "Credit", JobTread's own template for one.
 * QuickBooks has no negative expense; JT sends a negative document as a vendor
 * credit. Same rule as `_jtSunsetDocName` in ascent-appscript.
 */
export type SunsetDocName = "Expense" | "Credit";
export const sunsetDocName = (cost: number | null | undefined): SunsetDocName =>
  (cost ?? 0) < 0 ? "Credit" : "Expense";

/**
 * SUNSET RETURNS RIDE ON THEIR OWN CREDIT. QuickBooks reads a credit's amounts
 * as positive, so one document carrying a purchase AND a return pushes the
 * return inverted. A Sunset invoice with both is split: its returns (the
 * negative lines) go on a Credit numbered "<invoice #>-CR", and its purchases
 * stay on the original as an Expense. The sales-tax line counts as neither and
 * stays with the purchases. Same rule as `_jtSplitSunsetReturns` in
 * ascent-appscript, which splits a captured invoice before its first push.
 *
 * `mixed` is true only when each side has a real line.
 */
export function splitSunsetLines<T>(
  lines: T[],
  amountOf: (l: T) => number,
  isTax: (l: T) => boolean = () => false,
): { purchases: T[]; returns: T[]; mixed: boolean } {
  const returns = lines.filter((l) => !isTax(l) && amountOf(l) < 0);
  const purchases = lines.filter((l) => !returns.includes(l));
  const mixed = returns.length > 0 && purchases.some((l) => !isTax(l) && amountOf(l) > 0);
  return { purchases, returns, mixed };
}

/** The externalId of a split invoice's Credit: "<invoice #>-CR", inside JT's 32. */
export const sunsetCreditExternalId = (externalId: string) => `${externalId.trim().slice(0, 29)}-CR`;

/**
 * WRITE — create a split invoice's Credit: a draft Sunset document named
 * "Credit", due on issue, carrying only the returns. Push as stays "bill" —
 * JobTread files a negative bill as a vendor credit itself. No tax line.
 */
export async function createSunsetCredit(
  cfg: PaveConfig,
  args: {
    jobId: string;
    accountId: string;
    subject: string;
    /** The ORIGINAL invoice's externalId; the Credit's is derived from it. */
    externalId: string;
    issueDate: string;
    jobLocationName?: string;
    jobLocationAddress?: string;
    pushToQuickBooks?: boolean;
    lines: NewBillLine[];
  },
): Promise<{ id: string; externalId: string }> {
  const externalId = sunsetCreditExternalId(args.externalId);
  const { id } = await createVendorBill(cfg, {
    jobId: args.jobId,
    accountId: args.accountId,
    vendorName: "Sunset Builders Supply",
    subject: `${args.subject} (returns)`.slice(0, 128),
    externalId,
    issueDate: args.issueDate,
    dueDate: args.issueDate,
    taxAmount: 0,
    jobLocationName: args.jobLocationName,
    jobLocationAddress: args.jobLocationAddress,
    pushToQuickBooks: args.pushToQuickBooks,
    billType: "Bill",
    docName: "Credit",
    lines: args.lines,
  });
  return { id, externalId };
}

/** What the bulk switch will do to a draft Sunset bill. */
export type SunsetSwitchTarget = SunsetDocName | "Split";

/** A draft Sunset bill, as the bulk switch lists it. */
export interface DraftSunsetBill {
  id: string;
  jobId: string;
  jobName: string;
  externalId: string;
  issueDate: string;
  cost: number;
  name: string;
  qboDocumentType: string;
  /** "Split" = it carries a purchase and a return (see splitSunsetLines). */
  target: SunsetSwitchTarget;
}

/**
 * Why the bulk switch must leave this Sunset bill alone, or "" when it may act
 * on it. Not a draft, or already in QuickBooks, or already done: an Expense on
 * both fields, or a document named Credit. A `mixed` bill always has work left —
 * its returns still have to come off.
 */
export function sunsetSwitchBlocker(d: {
  status?: string | null;
  cost?: number | null;
  name?: string | null;
  qboDocumentType?: string | null;
  qboId?: string | null;
  mixed?: boolean;
  externalId?: string | null;
}): "" | "not draft" | "in QuickBooks" | "already an Expense" | "already a Credit" | "a statement bill" {
  // A statement bill is the payable, on terms — never an Expense.
  if (isSunsetStatementBill(d.externalId)) return "a statement bill";
  if (d.status && d.status !== "draft") return "not draft";
  if (d.qboId) return "in QuickBooks";
  if (d.mixed) return "";
  if (sunsetDocName(d.cost) === "Credit") return d.name === "Credit" ? "already a Credit" : "";
  if (d.name === "Expense" && d.qboDocumentType === "purchase") return "already an Expense";
  return "";
}

/**
 * Every DRAFT Sunset vendor bill in the org that still needs the switch.
 * Read-only. Lines come from a second, org-wide cost-item read joined by
 * document id — nesting them in the paged documents read would 413.
 */
export async function getDraftSunsetBills(cfg: PaveConfig): Promise<DraftSunsetBill[]> {
  const sunsetId = (process.env.JT_SUNSET_VENDOR_ID ?? "").trim();
  const vendor = sunsetId
    ? [["account", "id"], sunsetId]
    : [["account", "name"], "like", "%Sunset Builders%"];
  const lineVendor = sunsetId
    ? [["document", "account", "id"], sunsetId]
    : [["document", "account", "name"], "like", "%Sunset Builders%"];
  const [rows, lines] = await Promise.all([
    pageAll<any>(cfg, {
      label: "organization.documents (draft Sunset bills)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          documents: {
            $: { where: { and: [["type", "vendorBill"], ["status", "draft"], vendor] }, ...args },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              externalId: {},
              issueDate: {},
              cost: {},
              qboDocumentType: {},
              qboId: {},
              account: { id: {}, name: {} },
              job: { id: {}, name: {} },
            },
          },
        },
      }),
      pick: (a) => a?.organization?.documents,
    }),
    pageAll<any>(cfg, {
      label: "organization.costItems (draft Sunset bill lines)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          costItems: {
            $: {
              where: {
                and: [
                  [["document", "type"], "vendorBill"],
                  [["document", "status"], "draft"],
                  lineVendor,
                ],
              },
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              description: {},
              cost: {},
              costCode: { number: {} },
              document: { id: {} },
            },
          },
        },
      }),
      pick: (a) => a?.organization?.costItems,
    }),
  ]);
  const linesByDoc = new Map<string, any[]>();
  for (const l of lines) {
    const id = l.document?.id;
    if (!id) continue;
    (linesByDoc.get(id) ?? linesByDoc.set(id, []).get(id)!).push(l);
  }
  const bills: DraftSunsetBill[] = [];
  for (const d of rows) {
    if (!isSunsetVendor({ id: d.account?.id, name: d.account?.name })) continue;
    const { mixed } = splitSunsetLines<any>(linesByDoc.get(d.id) ?? [], (l) => Number(l.cost) || 0, isSalesTaxLine);
    if (sunsetSwitchBlocker({ ...d, status: "draft", mixed })) continue;
    bills.push({
      id: d.id,
      jobId: d.job?.id ?? "",
      jobName: d.job?.name ?? "",
      externalId: d.externalId ?? "",
      issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : "",
      cost: typeof d.cost === "number" ? d.cost : 0,
      name: d.name ?? "",
      qboDocumentType: d.qboDocumentType ?? "",
      target: mixed ? "Split" : sunsetDocName(d.cost),
    });
  }
  bills.sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.externalId.localeCompare(b.externalId));
  return bills;
}

export function isExpenseDoc(d: { name?: string | null; qboDocumentType?: string | null }): boolean {
  return d.qboDocumentType === "purchase" || d.name === "Expense";
}

/**
 * WRITE — create a draft vendor bill (createDocument type:vendorBill). No
 * `status` arg: newly created bills land as DRAFT (the coding queue), exactly
 * like the production Apps Script push.
 *
 * Sales tax goes on as its OWN cost item coded 88 80 00, and the document's tax
 * field is pinned to 0 — see src/lib/salesTax.ts for why the field cannot carry
 * it. Line costs are the face values printed on the invoice; nothing is grossed
 * up, because nothing de-taxes them on the way back.
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

  // Sales tax as its own line, last, so the material lines keep their order.
  const taxAmount = Math.round((Number(args.taxAmount) || 0) * 100) / 100;
  if (taxAmount > 0) {
    const taxLine: Record<string, unknown> = {
      _type: "costItem",
      name: SALES_TAX_LINE_NAME,
      description: SALES_TAX_CSI,
      unitCost: taxAmount,
      quantity: 1,
      isTaxable: false,
      customFieldValues: [{ customFieldId: CF_COST_CODES, value: SALES_TAX_CSI }],
    };
    if (args.salesTaxJobCostItemId) taxLine.jobCostItemId = args.salesTaxJobCostItemId;
    lineItems.push(taxLine);
  }

  const docArgs: Record<string, unknown> = {
    type: "vendorBill",
    jobId: args.jobId,
    accountId: args.accountId,
    name: args.docName ?? args.billType ?? "Bill",
    qboDocumentType: qboDocumentTypeFor(args.billType ?? "Bill"),
    ...(args.billType === "Expense"
      ? { qboAccountId: expenseAccountFor({ id: args.accountId, name: args.vendorName }) }
      : {}),
    subject: args.subject,
    externalId: args.externalId,
    issueDate: args.issueDate,
    fromName: args.vendorName,
    toName: "Ascent Building Co",
    taxRate: 0,
    // Tax is a line item now. The tax NAME is never sent — sending it is what
    // un-hides the document tax field, and the amount is pinned to 0 so a
    // template default cannot re-introduce the spread.
    nonRecoverableTax: 0,
    lineItems,
    includeInBudget: true,
    qboIsIgnored: !(args.pushToQuickBooks ?? true),
    qboIsBillable: true,
  };
  if (args.jobLocationName) docArgs.jobLocationName = args.jobLocationName;
  if (args.jobLocationAddress) docArgs.jobLocationAddress = args.jobLocationAddress;
  if (args.billType === "Expense" || args.docName === "Credit") docArgs.dueDate = args.issueDate;
  else if (args.dueDate) docArgs.dueDate = args.dueDate;
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
 * WRITE — put a NEW set of cost lines on an EXISTING bill, replacing the ones
 * it carries. This is what a vendor's revised invoice needs: the same document
 * keeps its id, number, dates, status, Drive file and QuickBooks linkage, and
 * only what it costs changes. The bill is NEVER deleted and re-created — see
 * the void rule in CLAUDE.md, and the appscript mirror keys on `externalId`.
 *
 * `deleteIds` is the caller's list of the lines to remove — normally every
 * non-tax line it just read. IT MUST BE COMPLETE: `getBillDetail` reads at most
 * 100 cost items and does not page, so a caller that hands over a short list
 * replaces the whole bill and deletes only part of it, leaving the tail on top
 * of the new lines. Check the read was not truncated before calling.
 * The SALES TAX line is not in it and must not be:
 * `setBillTax` owns that line, and updates, adds or removes it from the new
 * `taxAmount` on its own.
 *
 * ORDER MATTERS. The new lines are created BEFORE the old ones are deleted, so
 * a failure part-way leaves the bill DOUBLED rather than EMPTIED. A doubled
 * bill is loud — it sits in the coding queue at twice the invoice and someone
 * fixes it. An emptied one is silent, and silent is what loses money.
 *
 * The caller journals the before-image: it already holds the lines this
 * removes, which is the snapshot CLAUDE.md requires of any path that deletes
 * one.
 */
export async function replaceBillLines(
  cfg: PaveConfig,
  args: {
    docId: string;
    lines: NewBillLine[];
    deleteIds: string[];
    taxAmount: number;
    salesTaxJobCostItemId?: string;
  },
): Promise<{ created: number; deleted: number; tax: number }> {
  // Sales tax has exactly one home on a bill: the 88 80 00 line `setBillTax`
  // owns. An extracted line coded there would be created AND then rewritten by
  // that call, so fold any such line into the tax figure instead of creating it.
  // Folding cannot lose the money the way skipping could.
  let taxAmount = Number(args.taxAmount) || 0;
  const newLines: NewBillLine[] = [];
  for (const l of args.lines) {
    if (isSalesTaxLine({ name: l.name, description: l.description, code: l.costCode })) {
      taxAmount += (Number(l.unitCost) || 0) * (Number(l.quantity) || 0);
      continue;
    }
    newLines.push(l);
  }

  let created = 0;
  for (const l of newLines) {
    await createLine(cfg, args.docId, {
      name: l.name,
      description: l.description ?? "",
      unitCost: l.unitCost,
      quantity: l.quantity,
      jobCostItemId: l.jobCostItemId,
      costCode: l.costCode,
    });
    created++;
  }

  let deleted = 0;
  for (const id of args.deleteIds) {
    await deleteLine(cfg, id);
    deleted++;
  }

  const tax = await setBillTax(cfg, args.docId, taxAmount, args.salesTaxJobCostItemId);
  return { created, deleted, tax };
}

/**
 * The bill on a job that carries this externalId (an ExpID), among the job's 50
 * newest bills, or "" when none matches yet. Email Invoices' "Code this bill →"
 * link uses it right after a push, so the newest bills are where it lands. Pave
 * cannot filter on externalId, so the match is made here.
 */
export async function findNewJobBillByExternalId(
  cfg: PaveConfig,
  jobId: string,
  externalId: string,
): Promise<string> {
  const target = externalId.trim();
  if (!target) return "";
  const r = await pave<{ job: { documents: { nodes: { id: string; externalId?: string }[] } } }>(cfg, {
    job: {
      $: { id: jobId },
      documents: {
        $: {
          size: 50,
          where: { "=": [{ field: "type" }, { value: "vendorBill" }] },
          sortBy: [{ field: "createdAt", order: "desc" }],
        },
        nodes: { id: {}, externalId: {} },
      },
    },
  });
  return r.job.documents.nodes.find((d) => (d.externalId ?? "").trim() === target)?.id ?? "";
}

/**
 * The newest month an Amazon import filed bills into, "YYYY-MM", or "" for
 * never. The import files each order on the LAST day of its billing month and
 * ids it `AMZ-<order>`, so the newest such bill's issue date names the month.
 * A voided (denied) bill does not count. Pave cannot filter on externalId, so
 * the newest Amazon bills are read and the id is checked here.
 */
export async function getLastAmazonBillMonth(cfg: PaveConfig): Promise<string> {
  type R = {
    currentGrant: {
      organization: {
        documents: { nodes: { issueDate?: string; externalId?: string; status?: string }[] };
      };
    };
  };
  const r = await pave<R>(cfg, {
    currentGrant: {
      organization: {
        documents: {
          $: {
            size: 50,
            where: {
              and: [
                { "=": [{ field: "type" }, { value: "vendorBill" }] },
                { like: [{ field: ["account", "name"] }, { value: "%Amazon%" }] },
              ],
            },
            sortBy: [{ field: "issueDate", order: "desc" }],
          },
          nodes: { issueDate: {}, externalId: {}, status: {} },
        },
      },
    },
  });
  const bill = r.currentGrant.organization.documents.nodes.find(
    (d) => (d.externalId ?? "").startsWith("AMZ-") && d.status !== "denied",
  );
  return (bill?.issueDate ?? "").slice(0, 7);
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
  let hit: string | null = null;
  // 1000 pages is a deliberately high ceiling, not an expectation: a WRONG "not
  // found" here makes the caller create a duplicate bill, so running out of
  // pages must throw rather than answer no.
  await pageEach<any>(
    cfg,
    {
      label: "account.documents (externalId lookup)",
      size: 50,
      maxPages: 1000,
      query: (args) => ({
        account: {
          $: { id: accountId },
          documents: { $: args, nextPage: {}, nodes: { id: {}, externalId: {} } },
        },
      }),
      pick: (r) => r?.account?.documents,
    },
    (rows) => {
      for (const n of rows) {
        if (String(n.externalId ?? "").trim() === target) {
          hit = n.id;
          return "stop";
        }
      }
      if (rows.length === 0) return "stop"; // an empty page ends the scan
    },
  );
  return hit;
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
  // Same reasoning as findBillByExternalId: a short scan here reports an
  // already-ingested order as new, so the ceiling throws rather than answers.
  await pageEach<any>(
    cfg,
    {
      label: "account.documents (bulk externalId lookup)",
      maxPages: 1000,
      query: (args) => ({
        account: {
          $: { id: accountId },
          documents: { $: args, nextPage: {}, nodes: { id: {}, externalId: {} } },
        },
      }),
      pick: (r) => r?.account?.documents,
    },
    (rows) => {
      for (const n of rows) {
        const ext = String(n.externalId ?? "").trim();
        if (ext && want.has(ext)) found.add(ext);
      }
      // Every wanted id accounted for, or an empty page — either ends the scan.
      if (rows.length === 0 || found.size === want.size) return "stop";
    },
  );
  return [...found];
}

/** A job's name + location address, for the bill header fields. */
export async function getJobHeaderInfo(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ name: string; address: string; customer: string }> {
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      location: { address: {}, account: { name: {} } },
    },
  });
  return {
    name: r?.job?.name ?? "",
    address: r?.job?.location?.address ?? "",
    customer: r?.job?.location?.account?.name ?? "",
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
export async function _resolveShopJobIdUncached(cfg: PaveConfig): Promise<string> {
  const jobs = await getJobs(cfg, true); // include closed — fail loud, not silent, if it's ever closed
  const hit = jobs.find(
    (j) =>
      j.name.trim().toLowerCase() === "shop" &&
      (j.customer ?? "").trim().toLowerCase() === "ascent",
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
export async function findShopBuybackBill(
  cfg: PaveConfig,
  shopJobId: string,
  externalId: string,
): Promise<string | null> {
  let hit: string | null = null;
  await pageEach<any>(
    cfg,
    {
      label: "job.documents (Shop buyback lookup)",
      maxPages: 200,
      query: (args) => ({
        job: {
          $: { id: shopJobId },
          documents: {
            $: { where: { and: [["type", "vendorBill"]] }, ...args },
            nextPage: {},
            nodes: { id: {}, externalId: {} },
          },
        },
      }),
      pick: (r) => r?.job?.documents,
    },
    (rows) => {
      for (const n of rows) {
        if (String(n.externalId ?? "").trim() === externalId) {
          hit = n.id;
          return "stop";
        }
      }
      if (rows.length === 0) return "stop";
    },
  );
  return hit;
}

/** Every buyback line codes to this CSI on the Shop job — the org cost code
 *  "99 20 00 Buybacks" the owner added 2026-09-09. */
export const BUYBACK_CSI = "99 20 00";

/**
 * The Shop job's 99 20 00 budget leaf — where every buyback line codes.
 * Confirmed live 2026-08-05: JobTread REJECTS createCostItem on an existing
 * vendor bill with no jobCostItemId ("A jobCostItemId is required to create a
 * new cost item for this Vendor Bill", 400) — unlike a brand-new bill's initial
 * lineItems array, which tolerates an uncoded line fine. So a buyback line
 * can't land uncoded; it codes to 99 20 00, and the ORIGINAL code (if any)
 * rides along in the new line's description.
 *
 * REFRESH-ON-MISS then CREATE-ON-MISS, like getSalesTaxLeafId: a miss re-reads
 * the budget live, and a genuine miss adds the $0 leaf. Buybacks used to land
 * on an "Uncategorized" catch-all, which was one of JobTread's own auto
 * rollups — it vanished when the Shop budget was rebuilt (2026-09-09) and every
 * buyback started failing. A real leaf carrying the cost code stays put.
 */
export async function resolveShopBuybackLeaf(cfg: PaveConfig, shopJobId: string): Promise<string> {
  return cachedRef(`shopbuyback:${cfg.orgId}:${shopJobId}`, 5 * 60_000, async () => {
    const find = (items: BudgetItem[]) => items.find((b) => b.number === BUYBACK_CSI)?.id;
    const hit =
      find(await getJobBudget(cfg, shopJobId)) ?? find(await _getJobBudgetUncached(cfg, shopJobId));
    if (hit) return hit;

    const costCodeId = await resolveCostCodeId(cfg, BUYBACK_CSI);
    if (!costCodeId) {
      throw new Error(
        `No "${BUYBACK_CSI}" cost code in JobTread — add it, then retry the buyback.`,
      );
    }
    const created = await pave(cfg, {
      createCostItem: {
        $: {
          jobId: shopJobId,
          costCodeId,
          name: "Buybacks",
          quantity: 0,
          unitCost: 0,
          isTaxable: false,
        },
        createdCostItem: { id: {} },
      },
    });
    const id = created?.createCostItem?.createdCostItem?.id;
    if (!id) throw new Error(`Could not add the ${BUYBACK_CSI} budget leaf to the Shop job.`);
    clearJobCostCaches(); // the Shop budget just gained a leaf
    return id as string;
  });
}
