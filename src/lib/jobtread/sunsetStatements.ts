// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { WARRANTY_CSI } from "@/lib/warranty";
import { cachedRef, clearJobCostCaches, pageAll, pageEach, pave, type PaveConfig, PaveTooManyPagesError } from "./core";
import { _isInvoicedToClient, _isOnAnyInvoice } from "./unbilled";
import { _getJobBudgetUncached, type BudgetItem, getJobBudget, getSalesTaxByDoc, getWarrantyByDoc } from "./codingQueue";
import { createLine, deleteLine } from "./homeJobBoard";
import type { CsiAmount, InvoicePreviewMeta, UninvoicedBillLine, UninvoicedBills } from "./invoiceStaging";
import { BUYBACK_CSI, type BuybackLineArgs, createVendorBill, findShopBuybackBill, getJobHeaderInfo, isExpenseDoc, resolveShopBuybackLeaf, resolveShopJobId } from "./billIngestion";
import { OFFICE_JOB_ID } from "./tasks";
// ---------------------------------------------------------------------------
// SUNSET STATEMENT BILLS — one draft Bill per monthly statement, on the Office
// job (owner, 2026-11-02). The statement bill is what gets PAID; the per-job
// Sunset invoices stay on their jobs for job cost. Its externalId is the
// statement's sheet ExpID, so nothing else mistakes it for an invoice: "STMT-…"
// before 2026-11-03, "<account #>_<Mon><Year>" ("11543_Oct2026") after.
// ---------------------------------------------------------------------------

/** The org cost code "88 70 00 Sunset Statements" every statement bill codes to. */
export const SUNSET_STATEMENT_CSI = "88 70 00";
/** The cost type of the Office job's 88 70 00 leaf: Sunset sells materials. */
export const SUNSET_STATEMENT_COST_TYPE = "Materials";

/** Is this externalId a statement bill's — a statement ExpID, in either format?
 *  Mirrors _sunpayIsStatementId in ascent-appscript (SunsetPayments.js). */
export const isSunsetStatementBill = (externalId?: string | null) =>
  /^STMT-|^\d{3,8}_[A-Z][a-z]{2}\d{4}(_\d+)?$/i.test(String(externalId ?? "").trim());

/**
 * The Office job's 88 70 00 budget leaf. Same REFRESH-ON-MISS then
 * CREATE-ON-MISS as resolveShopBuybackLeaf: a genuine miss adds a $0 leaf, so
 * a statement bill never lands uncoded.
 */
export async function resolveSunsetStatementLeaf(cfg: PaveConfig): Promise<string> {
  return cachedRef(`sunsetstmt:${cfg.orgId}:${OFFICE_JOB_ID}`, 5 * 60_000, async () => {
    const find = (items: BudgetItem[]) => items.find((b) => b.number === SUNSET_STATEMENT_CSI)?.id;
    const hit =
      find(await getJobBudget(cfg, OFFICE_JOB_ID)) ?? find(await _getJobBudgetUncached(cfg, OFFICE_JOB_ID));
    if (hit) return hit;

    const [costCodeId, costTypeId] = await Promise.all([
      resolveCostCodeId(cfg, SUNSET_STATEMENT_CSI),
      resolveCostTypeId(cfg, SUNSET_STATEMENT_COST_TYPE),
    ]);
    if (!costCodeId) {
      throw new Error(`No "${SUNSET_STATEMENT_CSI}" cost code in JobTread — add it, then retry.`);
    }
    if (!costTypeId) {
      throw new Error(`No "${SUNSET_STATEMENT_COST_TYPE}" cost type in JobTread — add it, then retry.`);
    }
    const created = await pave(cfg, {
      createCostItem: {
        $: {
          jobId: OFFICE_JOB_ID,
          costCodeId,
          // JobTread refuses a budget leaf with no cost type ("A costTypeId is
          // required", HTTP 400 — seen on Create Bills, 2026-11-02).
          costTypeId,
          name: "Sunset Statements",
          quantity: 0,
          unitCost: 0,
          isTaxable: false,
        },
        createdCostItem: { id: {} },
      },
    });
    const id = created?.createCostItem?.createdCostItem?.id;
    if (!id) throw new Error(`Could not add the ${SUNSET_STATEMENT_CSI} budget leaf to the Office job.`);
    clearJobCostCaches(); // the Office budget just gained a leaf
    return id as string;
  });
}

/**
 * The statement bills already on the Office job: externalId → doc id. Voided
 * (denied) bills count too — a voided bill keeps its externalId, and its
 * statement must not be billed again on its own. Throws on a failed read, so
 * the caller refuses to create (fail CLOSED, never duplicate).
 */
export async function getSunsetStatementBills(cfg: PaveConfig): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const b of await readSunsetStatementBills(cfg)) if (!out.has(b.externalId)) out.set(b.externalId, b.docId);
  return out;
}

/** A statement bill's JobTread state, for the Sunset Statements page. */
export interface SunsetStatementBillState {
  docId: string;
  externalId: string;
  /** draft | pending | approved | denied. */
  status: string;
  /** "Bill" or "Expense" — decides what Approve sets (see approvalStatusFor). */
  name: string;
  cost: number;
  amountPaid: number;
  balance: number;
  /** The newest payment's date ("" when none). */
  paidAt: string;
}

/** Every vendor bill on the Office job that is a statement bill, voided ones included. */
export async function readSunsetStatementBills(cfg: PaveConfig): Promise<SunsetStatementBillState[]> {
  const out: SunsetStatementBillState[] = [];
  await pageEach<any>(
    cfg,
    {
      label: "job.documents (Sunset statement bills)",
      // 20 bills x 5 payments. 50 x 10 answers 413 "Request Entity Too Large" —
      // JobTread sizes the request by page x nested page, not by what matches,
      // and the page swallowed that error, so no statement was ever marked paid
      // (probed live 2026-11-04). Only statement bills are asked for.
      size: 20,
      maxPages: 200,
      query: (args) => ({
        job: {
          $: { id: OFFICE_JOB_ID },
          documents: {
            $: { where: { and: [["type", "vendorBill"], ["externalId", "like", "STMT-%"]] }, ...args },
            nextPage: {},
            nodes: {
              id: {},
              externalId: {},
              status: {},
              name: {},
              cost: {},
              amountPaid: {},
              balance: {},
              // One or two payments per bill (probed 2026-11-03).
              documentPayments: { $: { size: 5 }, nodes: { payment: { paidAt: {} } } },
            },
          },
        },
      }),
      pick: (r) => r?.job?.documents,
    },
    (rows) => {
      for (const d of rows) {
        const ext = String(d.externalId ?? "").trim();
        if (!isSunsetStatementBill(ext)) continue;
        const paidAt = ((d.documentPayments?.nodes ?? []) as any[])
          .map((n) => String(n?.payment?.paidAt ?? ""))
          .sort()
          .pop();
        out.push({
          docId: d.id,
          externalId: ext,
          status: String(d.status ?? ""),
          name: String(d.name ?? ""),
          cost: Number(d.cost) || 0,
          amountPaid: Number(d.amountPaid) || 0,
          balance: Number(d.balance) || 0,
          paidAt: paidAt ?? "",
        });
      }
    },
  );
  return out;
}

/**
 * The LIVE statement bill per statement ExpID. A voided (denied) bill only
 * stands in when its statement has no other bill. Throws on a failed read.
 */
export async function getSunsetStatementBillStates(cfg: PaveConfig): Promise<Map<string, SunsetStatementBillState>> {
  const out = new Map<string, SunsetStatementBillState>();
  for (const b of await readSunsetStatementBills(cfg)) {
    const had = out.get(b.externalId);
    if (!had || (had.status === "denied" && b.status !== "denied")) out.set(b.externalId, b);
  }
  return out;
}

/** The org cost code with this CSI number, or undefined. */
/** The org cost type with this exact name ("Materials", "Other", …), or undefined. */
export async function resolveCostTypeId(cfg: PaveConfig, name: string): Promise<string | undefined> {
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      costTypes: { $: { size: 1, where: { and: [["name", name]] } }, nodes: { id: {} } },
    },
  });
  return r?.organization?.costTypes?.nodes?.[0]?.id ?? undefined;
}

export async function resolveCostCodeId(cfg: PaveConfig, number: string): Promise<string | undefined> {
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      costCodes: { $: { size: 1, where: { and: [["number", number]] } }, nodes: { id: {} } },
    },
  });
  return r?.organization?.costCodes?.nodes?.[0]?.id ?? undefined;
}

/**
 * Is this externalId a vendor's own invoice number? Not one of the IDs the
 * system mints: the Assistant's upload token ("INV-xxxxxxxx"), a JobTread
 * document id ("22…", which an unmatched-import row is keyed on), or a buyback
 * key ("BUYBACK-…").
 */
export function isVendorInvoiceNumber(externalId?: string | null): boolean {
  const s = String(externalId ?? "").trim();
  if (!s) return false;
  if (/^INV-[0-9a-f]{8}$/i.test(s)) return false;
  if (/^22[A-Za-z0-9]{8,}$/.test(s)) return false;
  if (/^BUYBACK-/i.test(s)) return false;
  return true;
}

/** The pre-2026-11-04 buyback key, kept so an older Shop bill is still found. */
export const legacyBuybackExternalId = (sourceDocId: string) => `BUYBACK-${sourceDocId}`.substring(0, 32);

/**
 * The Shop bill's externalId for a buyback: "<invoice #>-BB", so the Sunset
 * statement reconcile folds it back into the invoice it came off (owner,
 * 2026-11-04). Falls back to the legacy key only when the source bill carries
 * no vendor invoice number. Inside JobTread's 32-character cap.
 */
export function buybackExternalIdFor(sourceExternalId: string | null | undefined, sourceDocId: string): string {
  const ext = String(sourceExternalId ?? "").trim();
  return isVendorInvoiceNumber(ext) ? `${ext.slice(0, 29)}-BB` : legacyBuybackExternalId(sourceDocId);
}

/**
 * WRITE — "buyback": move one bill line off a client job's bill onto a draft bill
 * on the Ascent - Shop job (e.g. materials bought back for shop stock instead of
 * billed to the client). Reuses the same externalId idempotency trick
 * createVendorBill's callers use elsewhere (`<invoice #>-BB`, see
 * buybackExternalIdFor, scoped to
 * the SHOP job's documents — see findShopBuybackBill) so repeated buybacks off
 * the SAME source bill land additively on the SAME shop bill instead of each
 * click minting a new one; this also means the frontend needs no session state
 * to track "the shop bill I already created" — a second click just finds it
 * again.
 *
 * The new line codes to 99 20 00 "Buybacks" on the Shop budget (see
 * resolveShopBuybackLeaf — the client job's coding can't carry over anyway,
 * it's a different job's budget tree); `description` carries the original
 * code's label for reference.
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
        externalId: {},
        account: { id: {} },
      },
    }),
  ]);
  const src = doc?.document ?? {};
  const accountId = src.account?.id;
  if (!accountId) throw new Error("Source bill has no vendor account — can't create a Shop copy.");

  const buybackExternalId = buybackExternalIdFor(src.externalId, args.sourceDocId);
  const legacyExternalId = legacyBuybackExternalId(args.sourceDocId);
  const [shopDocIdFound, buybackLeafId] = await Promise.all([
    // A Shop bill made before the "<invoice #>-BB" form still carries
    // "BUYBACK-<doc id>": find it too, so a second click adds to it.
    findShopBuybackBill(cfg, shopJobId, buybackExternalId).then(
      (hit) => hit ?? (buybackExternalId === legacyExternalId ? null : findShopBuybackBill(cfg, shopJobId, legacyExternalId)),
    ),
    resolveShopBuybackLeaf(cfg, shopJobId),
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
    jobCostItemId: buybackLeafId,
    description: args.description,
    costCode: BUYBACK_CSI, // Cost Codes custom field, same as every coded line
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

/**
 * WRITE — detach a file from a document (the record only; the bytes stay in JT
 * storage). This exists for ONE case: a revised invoice replaces the one on
 * file. Two PDFs on one bill misfile both — the mirror picks the FIRST pdf as
 * the primary, so the superseded scan keeps the canonical name in JobTread and
 * in Drive while the revision sits beside it under its upload name.
 *
 * Not for pruning a bill's attachments in general: the Drive tree is the
 * archive of record, and the mirror only trashes its copy when the attachment
 * set CHANGES (a delete with nothing put back keeps the Drive copy).
 */
export async function deleteDocumentFile(cfg: PaveConfig, fileId: string): Promise<void> {
  await pave(cfg, { deleteFile: { $: { id: fileId } } });
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

  const bills = await pageAll<any>(cfg, {
    label: "job.documents (uninvoiced bills)",
    size: 25,
    query: (args) => ({
      job: {
        $: { id: jobId },
        documents: {
          $: {
            where: {
              and: [
                ["type", "vendorBill"],
                ["status", "in", statuses],
              ],
            },
            ...args,
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
            referencedDocuments: { nodes: { type: {}, status: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.job?.documents,
  });

  const isInvoiced = _isInvoicedToClient;
  // includeInvoiced relaxes the uninvoiced filter (shows bills already on a
  // customer invoice too); the invoiced flag lets the UI mark them.
  const open = bills.filter((b) => (includeInvoiced || !isInvoiced(b)) && inMonth(b.issueDate));

  // Uninvoiced time entries — a bare invoice pulls these too, so include them so
  // the preview total matches what JobTread will actually invoice.
  const timeEntries = await pageAll<any>(cfg, {
    label: "job.timeEntries (uninvoiced time)",
    size: 50,
    query: (args) => ({
      job: {
        $: { id: jobId },
        timeEntries: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            cost: {},
            startedAt: {},
            minutes: {},
            hourlyRate: {},
            user: { name: {} },
            costItem: { id: {}, costCode: { number: {}, name: {} } },
            referencedDocuments: { nodes: { type: {}, status: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.job?.timeEntries,
  });
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
  // Every open bill's item costs, coded or not, for the invoice preview's fee.
  const billItemCosts: number[] = [];
  await pageEach<any>(
    cfg,
    {
      label: "job.costItems (per-bill CSI breakdown)",
      query: (args) => ({
        job: {
          $: { id: jobId },
          costItems: {
            $: args,
            nextPage: {},
            nodes: { cost: {}, costCode: { number: {}, name: {} }, document: { id: {}, type: {} } },
          },
        },
      }),
      pick: (r) => r?.job?.costItems,
    },
    (rows) => {
      for (const n of rows) {
        const doc = n.document;
        if (!doc || doc.type !== "vendorBill" || !openIds.has(doc.id)) continue;
        billItemCosts.push(n.cost ?? 0);
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
    },
  );

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
        costItemId: t.costItem?.id ?? undefined,
        startedAt: t.startedAt ?? undefined,
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
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      location: {
        address: {},
        account: {
          id: {},
          name: {},
          primaryContact: {
            name: {},
            customFieldValues: { $: { size: 10 }, nodes: { value: {}, customField: { name: {} } } },
          },
        },
      },
      // The budget (cost items on no document) carries the job's markup.
      budget: {
        _: "costItems",
        $: { where: { and: [[["document", "id"], null], ["cost", "!=", 0]] } },
        cost: { _: "sum", $: "cost" },
        price: { _: "sum", $: "price" },
      },
    },
    organization: {
      $: { id: cfg.orgId },
      costCodes: {
        $: { size: 100, where: ["number", "like", "% 00 00"] },
        nodes: { number: {}, name: {} },
      },
    },
  });
  const acc = c?.job?.location?.account;
  const customer = acc?.id ? { id: acc.id, name: acc.name ?? "" } : null;
  const job = { id: jobId, name: c?.job?.name ?? "" };

  // JobTread prices each bill item, and each day's time per budget item, on
  // its own line: round(raw cost × markup), half up. Summing those roundings is
  // what lands the preview's fee on the invoice's to the cent (checked against
  // Monthly Invoice 004-424, 2026-11-12). The markup is rounded to 4 places
  // because the budget sums carry float noise (1.179999991…).
  const budgetCost = Number(c?.job?.budget?.cost) || 0;
  const markup = budgetCost
    ? Math.round(((Number(c?.job?.budget?.price) || 0) / budgetCost) * 1e4) / 1e4
    : 1;
  const r2 = (n: number) => Math.round(n * 100 + 1e-6) / 100;
  const feeOf = (cost: number) => r2(cost * markup) - r2(cost);
  const timeByDayItem = new Map<string, number>();
  for (const t of openTime) {
    const day = new Date(t.startedAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const k = `${day}|${t.costItem?.id ?? ""}`;
    timeByDayItem.set(k, (timeByDayItem.get(k) ?? 0) + (t.cost ?? 0));
  }
  const fee = r2(
    billItemCosts.reduce((s, n) => s + feeOf(n), 0) +
      Array.from(timeByDayItem.values()).reduce((s, n) => s + feeOf(n), 0),
  );
  const contact = acc?.primaryContact;
  const invoice: InvoicePreviewMeta = {
    jobNumber: String(c?.job?.number ?? ""),
    address: c?.job?.location?.address ?? "",
    accountName: acc?.name ?? "",
    contactName: contact?.name ?? "",
    email:
      (contact?.customFieldValues?.nodes ?? []).find((v: any) => /email/i.test(v?.customField?.name ?? ""))
        ?.value ?? "",
    markup,
    fee,
    divisions: Object.fromEntries(
      (c?.organization?.costCodes?.nodes ?? []).map((n: any) => [String(n.number), String(n.name ?? "")]),
    ),
  };

  return { customer, job, lines, total, invoice };
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

  const q = (nodes: Record<string, unknown>, args: Record<string, unknown>) => ({
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
          ...args,
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
    id: {},
    cost: {},
    status: {},
    job: { id: {}, name: {}, location: { account: { id: {}, name: {} } } },
    referencedDocuments: { nodes: { type: {}, status: {} } },
  };
  const min = {
    id: {},
    cost: {},
    status: {},
    job: { id: {}, name: {} },
    referencedDocuments: { nodes: { type: {}, status: {} } },
  };

  const walkWith = (nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: "organization.documents (the month's bills, all jobs)",
      size: 25,
      query: (args) => q(nodes, args),
      pick: (r) => r?.organization?.documents,
    });
  // Downgrade once; an unconfirmed field name won't break the view. Too much
  // data is not a field-name problem, so that is not retried.
  const bills = await walkWith(rich).catch((e) => {
    if (e instanceof PaveTooManyPagesError) throw e;
    return walkWith(min);
  });

  const isInvoiced = _isInvoicedToClient;

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

/**
 * Every OPEN client invoice in the org — the raw rows behind AR ageing.
 *
 * "Open" = a live (`pending` or `approved`) `customerInvoice` with a balance
 * still on it. `denied` is excluded because a denied invoice was withdrawn, and
 * `draft` because it was never sent — neither is money anyone owes.
 *
 * `balance` and `amountPaid` are READ, never recomputed. JobTread derives them
 * from QuickBooks (approving pushes the document; the payment comes back), so
 * they are the accounting system's own answer. Recomputing them here would
 * produce a second, disagreeing figure for the same question — which is exactly
 * the failure the invoice review's math checks exist to catch elsewhere.
 *
 * ONE org-wide paged `organization.documents` walk, the same connection
 * getMonthlyInvoiceJobs uses. Nothing heavy is nested inside it (no lines, no
 * referencedDocuments), so it pages at 100 rather than 25 — the 413 rule bites
 * only when a heavy connection sits inside a paged one.
 *
 * The `job.location.account` nest is the customer name; a grant that cannot
 * read it falls back to job id/name only, the same downgrade-once guard
 * getMonthlyInvoiceJobs and getAllDraftBills use.
 */
export async function getOpenCustomerInvoices(cfg: PaveConfig): Promise<OpenInvoiceRow[]> {
  const q = (nodes: Record<string, unknown>, args: Record<string, unknown>) => ({
    organization: {
      $: { id: cfg.orgId },
      id: {},
      documents: {
        $: {
          where: {
            and: [
              ["type", "customerInvoice"],
              ["status", "in", ["pending", "approved"]],
            ],
          },
          ...args,
        },
        nextPage: {},
        nodes,
      },
    },
  });
  const scalars = {
    id: {},
    number: {},
    status: {},
    issueDate: {},
    dueDate: {},
    price: {},
    priceWithTax: {},
    amountPaid: {},
    balance: {},
  };
  const rich = { ...scalars, job: { id: {}, name: {}, location: { account: { name: {} } } } };
  const min = { ...scalars, job: { id: {}, name: {} } };

  const walkWith = (nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: "organization.documents (open client invoices)",
      query: (args) => q(nodes, args),
      pick: (r) => r?.organization?.documents,
    });
  // Downgrade once; an unreadable customer name is not a dead page. Too much
  // data is not a field-name problem, so that is not retried.
  const docs = await walkWith(rich).catch((e) => {
    if (e instanceof PaveTooManyPagesError) throw e;
    return walkWith(min);
  });

  return docs.map((d) => ({
    id: d.id,
    number: d.number != null ? String(d.number) : "",
    status: d.status ?? "",
    jobId: d.job?.id ?? "",
    jobName: d.job?.name ?? "",
    customerName: d.job?.location?.account?.name ?? "",
    issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : "",
    dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : "",
    total: typeof d.priceWithTax === "number" ? d.priceWithTax : (d.price ?? 0),
    amountPaid: typeof d.amountPaid === "number" ? d.amountPaid : 0,
    balance: typeof d.balance === "number" ? d.balance : 0,
  }));
}

/** One open client invoice, as `getOpenCustomerInvoices` returns it. */
export interface OpenInvoiceRow {
  id: string;
  number: string;
  status: string;
  jobId: string;
  jobName: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  /** Billed to the customer including tax. */
  total: number;
  /** Recorded against it, from QuickBooks. */
  amountPaid: number;
  /** Still owed, as JobTread states it. */
  balance: number;
}

/** One client document on a job: a proposal, change order, selection or invoice. */
export interface ClientDocRow {
  id: string;
  type: "customerOrder" | "customerInvoice";
  name: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string;
  /** Before tax. */
  price: number;
  /** What the customer is billed, tax included. */
  total: number;
  amountPaid: number;
  balance: number;
  /** An order that counts toward the job's budget (contract + change orders). */
  includeInBudget: boolean;
}

/**
 * Every client order and invoice on one job, every status, oldest first. The
 * contract, the change orders, what was billed, what was paid and what is still
 * owed — AscentBot's answer to "how much have we invoiced Berger?".
 *
 * `amountPaid` and `balance` are READ, never recomputed (see
 * getOpenCustomerInvoices). Scalars only inside the paged connection, so it
 * pages at 100 with no 413 risk. Fields confirmed by a live read 2026-10-30.
 */
export async function getJobClientDocuments(cfg: PaveConfig, jobId: string): Promise<ClientDocRow[]> {
  const docs = await pageAll<any>(cfg, {
    label: "job.documents (client orders and invoices)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        documents: {
          $: { where: { and: [["type", "in", ["customerOrder", "customerInvoice"]]] }, ...args },
          nextPage: {},
          nodes: {
            id: {},
            type: {},
            name: {},
            number: {},
            status: {},
            issueDate: {},
            dueDate: {},
            price: {},
            priceWithTax: {},
            amountPaid: {},
            balance: {},
            includeInBudget: {},
          },
        },
      },
    }),
    pick: (r) => r?.job?.documents,
  });
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return docs
    .map((d) => ({
      id: String(d.id ?? ""),
      type: d.type === "customerInvoice" ? ("customerInvoice" as const) : ("customerOrder" as const),
      name: String(d.name ?? ""),
      number: d.number != null ? String(d.number) : "",
      status: String(d.status ?? ""),
      issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : "",
      dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : "",
      price: num(d.price),
      total: typeof d.priceWithTax === "number" ? d.priceWithTax : num(d.price),
      amountPaid: num(d.amountPaid),
      balance: num(d.balance),
      includeInBudget: d.includeInBudget === true,
    }))
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
}

/**
 * Every job's UNINVOICED TIME cost for one billing month, keyed by job id — the
 * other half of "to be invoiced". A client invoice pulls logged labor along with
 * the vendor bills, so a roster figure built from bills alone reads low on every
 * job the crew actually worked. Same rule as the per-job `getUninvoicedBills`
 * total, which is bills + time.
 *
 * ONE org-wide paged `organization.timeEntries` walk — the same connection the
 * monthly Labor Report reads — narrowed server-side to the month's `startedAt`.
 * That is why this is affordable where a per-job time fetch is not.
 *
 * Entries already on a customer invoice drop, by the same `referencedDocuments`
 * flag getUninvoicedBills uses. Paged at 25, not the Labor Report's 100, because
 * referencedDocuments nested inside a paged connection 413s at larger sizes.
 */
export async function getMonthlyInvoiceTime(
  cfg: PaveConfig,
  year: number,
  month: number,
): Promise<Record<string, number>> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const byJob: Record<string, number> = {};
  await pageEach<any>(
    cfg,
    {
      label: "organization.timeEntries (the month's uninvoiced time)",
      size: 25,
      // 200 pages x 25 = 5,000 entries: a runaway guard, not a month's size.
      maxPages: 200,
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          timeEntries: {
            $: {
              where: {
                and: [
                  ["startedAt", ">=", first],
                  ["startedAt", "<=", `${last}T23:59:59`],
                ],
              },
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              cost: {},
              job: { id: {} },
              referencedDocuments: { nodes: { type: {}, status: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.timeEntries,
    },
    (rows) => {
      for (const t of rows) {
        const jobId = t.job?.id;
        if (!jobId) continue;
        if (_isInvoicedToClient(t)) continue;
        byJob[jobId] = (byJob[jobId] ?? 0) + (t.cost ?? 0);
      }
    },
  );

  return byJob;
}

/** One vendor bill in the all-jobs month list — carries its own job + customer,
 *  since this list spans every job. */
export interface AllJobsBill {
  id: string;
  vendor: string;
  cost: number;
  issueDate: string;
  createdAt: string;
  status: string;
  invoiced: boolean;
  /** The bill's 88 80 00 sales-tax line. Part of `cost` (which is what the
   *  vendor billed), and taken OUT of any "to be invoiced" figure — the client
   *  is never billed the tax Ascent paid. */
  tax: number;
  /** The bill's 88 90 00 warranty-work lines. Part of `cost`, and out of any
   *  "to be invoiced" figure the same way — see src/lib/warranty.ts. */
  warranty: number;
  /** On a customer invoice of ANY status but denied — see `_isOnAnyInvoice`. */
  onInvoice: boolean;
  /** Does an invoice exist for THIS bill's job + month? Derived per job from
   *  every bill in the month before `includeInvoiced` filters any out. */
  monthInvoiceExists: boolean;
  /** Money recorded against the bill — JobTread computes both from QuickBooks.
   *  A draft reads 0 / 0, so read them as a pair (`billPaidState`). */
  amountPaid: number;
  /** Still owed on the bill: cost − amountPaid. */
  balance: number;
  /** Filed as an Expense rather than a Bill — the document's own name, the same
   *  flag the bill page's Bill/Expense toggle sets (see setBillFields). */
  isExpense: boolean;
  jobId: string;
  jobName: string;
  customerName: string;
}

/**
 * Every vendor bill issued in a billing month, ACROSS ALL JOBS, as a flat list —
 * the no-job "all bills for the month" view. Same one org-wide paged
 * `organization.documents` walk as getMonthlyInvoiceJobs (which groups the same
 * bills by job); this one keeps them flat and adds each bill's createdAt,
 * issueDate and vendor so the caller can sort newest-added-first and label each
 * row. Draft bills are included by default here (the office wants to see what's
 * still coding across the shop); invoiced bills drop unless includeInvoiced.
 *
 * Ordered by createdAt (when the bill was ADDED to JobTread), not issueDate:
 * the whole month's bills share one end-of-month invoicing date, so issueDate
 * can't distinguish them — arrival order is what the office reads them in. Same
 * ordering the per-job board uses (see getJobBillsForMonth).
 */
export async function getAllBillsForMonth(
  cfg: PaveConfig,
  year: number,
  month: number,
  {
    includeInvoiced = false,
    includeDrafts = true,
  }: { includeInvoiced?: boolean; includeDrafts?: boolean } = {},
): Promise<AllJobsBill[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const statuses = includeDrafts ? ["draft", "pending", "approved"] : ["pending", "approved"];

  const q = (nodes: Record<string, unknown>, args: Record<string, unknown>) => ({
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
          ...args,
        },
        nextPage: {},
        nodes,
      },
    },
  });
  // Rich carries the customer (job.location.account) and vendor name; an
  // unconfirmed nested field won't break the view — fall back to the minimal
  // selection (same guard as getMonthlyInvoiceJobs / getAllDraftBills).
  const rich = {
    id: {},
    cost: {},
    status: {},
    issueDate: {},
    createdAt: {},
    fromName: {},
    name: {},
    qboDocumentType: {},
    amountPaid: {},
    balance: {},
    account: { name: {} },
    job: { id: {}, name: {}, location: { account: { name: {} } } },
    referencedDocuments: { nodes: { type: {}, status: {} } },
  };
  const min = {
    id: {},
    cost: {},
    status: {},
    issueDate: {},
    createdAt: {},
    fromName: {},
    name: {},
    amountPaid: {},
    balance: {},
    job: { id: {}, name: {} },
    referencedDocuments: { nodes: { type: {}, status: {} } },
  };

  const walkWith = (nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: "organization.documents (every job's bills this month)",
      size: 25,
      query: (args) => q(nodes, args),
      pick: (r) => r?.organization?.documents,
    });
  // Downgrade once; an unconfirmed field name won't break the view. Too much
  // data is not a field-name problem, so that is not retried.
  const raw = await walkWith(rich).catch((e) => {
    if (e instanceof PaveTooManyPagesError) throw e;
    return walkWith(min);
  });

  const isInvoiced = _isInvoicedToClient;
  // Each bill's sales-tax line, so a caller can net it out of a "to be
  // invoiced" total (`cost` itself stays what the vendor billed).
  const [taxByDoc, warrantyByDoc] = await Promise.all([
    getSalesTaxByDoc(cfg, year, month),
    getWarrantyByDoc(cfg, year, month),
  ]);
  // Which jobs already have an invoice for this month — read off the FULL walk,
  // before includeInvoiced drops the bills that are on it (see the same note in
  // getJobBillsForMonth).
  const jobsWithInvoice = new Set<string>();
  for (const b of raw) if (b?.job?.id && _isOnAnyInvoice(b)) jobsWithInvoice.add(b.job.id);

  const out: AllJobsBill[] = [];
  for (const b of raw) {
    const invoiced = isInvoiced(b);
    if (!includeInvoiced && invoiced) continue;
    const job = b.job;
    if (!job?.id) continue;
    out.push({
      id: b.id,
      vendor: String(b.account?.name ?? b.fromName ?? "Vendor"),
      cost: b.cost ?? 0,
      issueDate: b.issueDate ?? "",
      createdAt: b.createdAt ?? "",
      status: b.status ?? "",
      invoiced,
      tax: taxByDoc.get(b.id) ?? 0,
      warranty: warrantyByDoc.get(b.id) ?? 0,
      onInvoice: _isOnAnyInvoice(b),
      monthInvoiceExists: jobsWithInvoice.has(job.id),
      amountPaid: typeof b.amountPaid === "number" ? b.amountPaid : 0,
      balance: typeof b.balance === "number" ? b.balance : 0,
      isExpense: isExpenseDoc(b),
      jobId: job.id,
      jobName: job.name ?? "",
      customerName: job.location?.account?.name ?? "",
    });
  }
  // Newest-ADDED first (createdAt). The month's bills all share one end-of-month
  // issueDate, so it can't order them; fall back to issueDate then amount so a
  // record with no createdAt still sorts predictably. Same order the per-job
  // board uses.
  out.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      b.issueDate.localeCompare(a.issueDate) ||
      b.cost - a.cost,
  );
  return out;
}

/** A JobTread customer invoice, for linking + reconciliation. `cost` is the
 *  cost basis (JobTread guarantees it == Σ of the vendor bills the invoice
 *  pulled); `total` is priceWithTax — what the customer is actually billed. */
export interface InvoiceRef {
  id: string;
  number: string; // JT invoice #
  status: string; // draft | pending | approved (denied invoices are excluded; a draft here has NOT been counted as invoiced — see getInvoiceReconciliation)
  issueDate: string;
  cost: number; // cost basis
  total: number; // priceWithTax (billed amount)
  amountPaid: number;
}
export interface InvoiceReconciliation {
  // EVERY bill figure below is NET OF SALES TAX — the 88 80 00 line comes out
  // before the sum, because tax paid to a vendor is never billed to the client.
  // Non-denied customer invoices this month's bills/time landed on (links).
  invoices: InvoiceRef[];
  invoicedBillsCost: number; // Σ cost of the month's bills now on a live invoice
  uninvoicedBillsCost: number; // Σ cost of the month's bills on no live invoice
  uninvoicedTimeCost: number; // Σ cost of the month's uninvoiced time
  remaining: number; // uninvoicedBillsCost + uninvoicedTimeCost — still to invoice
  reconciled: boolean; // an invoice exists AND nothing is left uninvoiced
  // The slice of `remaining` that already sits on a DRAFT customer invoice, i.e.
  // captured but not sent. `remaining - onDraftInvoiceCost` is the money on no
  // invoice at all — the only part an "add or extend an invoice" instruction is
  // true of. When that's zero the month is staged and just needs sending.
  onDraftInvoiceCost: number;
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
 * bill (and uninvoiced time) for the month is on an invoice that has actually
 * gone out — non-denied AND non-draft. A DRAFT invoice does not count: it has
 * not been sent, so the bills on it still need invoicing. See the note at the
 * partition below for exactly where that distinction applies and where it
 * deliberately does not.
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
  //    Every cost here is NET OF SALES TAX: a bill's JobTread cost includes its
  //    88 80 00 line, and that tax is never billed to the client, so counting it
  //    would leave `remaining` permanently short of zero by the month's tax.
  //    Net of WARRANTY WORK too (88 90 00): Ascent's cost, billed to no client
  //    (src/lib/warranty.ts). The time walk below counts warranty entries at 0.
  const [taxByDoc, warrantyByDoc] = await Promise.all([
    getSalesTaxByDoc(cfg, year, month, jobId),
    getWarrantyByDoc(cfg, year, month, jobId),
  ]);
  const netCost = (b: { id: string; cost?: number }) =>
    Math.round(
      ((b.cost ?? 0) - (taxByDoc.get(b.id) ?? 0) - (warrantyByDoc.get(b.id) ?? 0)) * 100,
    ) / 100;

  const monthBills: { cost: number; invIds: string[] }[] = [];
  let draftBillsCost = 0;
  let draftBillCount = 0;
  await pageEach<any>(
    cfg,
    {
      label: "job.documents (reconcile: the month's bills)",
      size: 25,
      query: (args) => ({
        job: {
          $: { id: jobId },
          documents: {
            $: {
              where: {
                and: [
                  ["type", "vendorBill"],
                  ["status", "in", ["draft", "pending", "approved"]],
                ],
              },
              ...args,
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
      }),
      pick: (r) => r?.job?.documents,
    },
    (rows) => {
      for (const b of rows) {
        if (!inMonth(b.issueDate)) continue;
        if (b.status === "draft") {
          draftBillsCost += netCost(b);
          draftBillCount++;
          continue;
        }
        monthBills.push({ cost: netCost(b), invIds: invRefIds(b) });
      }
    },
  );

  // 2. Time for the month (a bare invoice pulls uninvoiced time too).
  const monthTime: { cost: number; invIds: string[] }[] = [];
  await pageEach<any>(
    cfg,
    {
      label: "job.timeEntries (reconcile: the month's time)",
      size: 50,
      query: (args) => ({
        job: {
          $: { id: jobId },
          timeEntries: {
            $: args,
            nextPage: {},
            nodes: {
              id: {},
              cost: {},
              startedAt: {},
              costItem: { costCode: { number: {} } },
              referencedDocuments: { nodes: { id: {}, type: {}, status: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.job?.timeEntries,
    },
    (rows) => {
      for (const t of rows) {
        if (!inMonth(t.startedAt)) continue;
        // Warranty time is Ascent's cost, billed to no client, so it adds
        // nothing to what is left to invoice. It still LINKS its invoice: a
        // warranty-record invoice that carries only warranty time must be
        // listed and reviewed like any other (src/lib/warranty.ts).
        const warranty = String(t.costItem?.costCode?.number ?? "").trim() === WARRANTY_CSI;
        monthTime.push({ cost: warranty ? 0 : t.cost ?? 0, invIds: invRefIds(t) });
      }
    },
  );

  // 3. ALL the job's customer invoices (any status) + the predecessor invoice(s)
  //    each one replaced (referencedDocuments filtered server-side to invoices,
  //    so we never page a big invoice's bill refs).
  const byId = new Map<string, any>();
  const replacedBy = new Map<string, any[]>(); // predecessor id -> invoices that replaced it
  await pageEach<any>(
    cfg,
    {
      label: "job.documents (reconcile: the job's client invoices)",
      size: 25,
      query: (args) => ({
        job: {
          $: { id: jobId },
          documents: {
            $: { where: { and: [["type", "customerInvoice"]] }, ...args },
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
      }),
      pick: (r) => r?.job?.documents,
    },
    (rows) => {
      for (const iv of rows) {
        byId.set(iv.id, iv);
        for (const p of (iv.referencedDocuments?.nodes ?? []) as any[]) {
          if (!p.id) continue;
          let arr = replacedBy.get(p.id);
          if (!arr) replacedBy.set(p.id, (arr = []));
          arr.push(iv);
        }
      }
    },
  );

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
  //
  //    "Live" here means non-denied, and DELIBERATELY still includes draft — a
  //    bill's only invoice being a draft is exactly the case a re-issue chain
  //    needs to keep pointing at, and evidence.ts's duplicate-billing check
  //    needs to see a draft to catch a bill duplicated onto it. So `linkedIds`
  //    (-> the `invoices` list this function returns) counts a draft as linked.
  //
  //    The COMPLETENESS math is a narrower question — has this bill actually
  //    been invoiced — and a draft has not gone out, so it has not. Reported
  //    live on Berger Main House: a bill referencing only draft invoice #12
  //    counted as invoiced, `uninvoicedBillsCost` (the board's "to be invoiced"
  //    figure) undercounted by the bill's whole cost, and `reconciled` came back
  //    true for a month nothing had actually been sent for.
  const linkedIds = new Set<string>();
  let invoicedBillsCost = 0;
  let uninvoicedBillsCost = 0;
  let onDraftInvoiceCost = 0;
  for (const b of monthBills) {
    const live = liveInvoiceFor(b.invIds);
    if (live) linkedIds.add(live.id);
    if (live && live.status !== "draft") {
      invoicedBillsCost += b.cost;
    } else {
      uninvoicedBillsCost += b.cost;
      if (live) onDraftInvoiceCost += b.cost;
    }
  }
  let uninvoicedTimeCost = 0;
  for (const t of monthTime) {
    const live = liveInvoiceFor(t.invIds);
    if (live) linkedIds.add(live.id);
    if (!live || live.status === "draft") {
      uninvoicedTimeCost += t.cost;
      if (live) onDraftInvoiceCost += t.cost;
    }
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
    onDraftInvoiceCost: Math.round(onDraftInvoiceCost * 100) / 100,
    draftBillsCost: Math.round(draftBillsCost * 100) / 100,
    draftBillCount,
  };
}
