import { NextRequest, NextResponse } from "next/server";
import {
  attachFileToDocument,
  clearJobCostCaches,
  createSunsetCredit,
  deleteLine,
  findBillByExternalId,
  getBillDetail,
  getBillJournalSnapshot,
  getDraftSunsetBills,
  getJobHeaderInfo,
  getLineJournalSnapshot,
  isSunsetVendor,
  QBO_SUNSET_EXPENSE_ACCOUNT_ID,
  setBillFields,
  splitSunsetLines,
  sunsetCreditExternalId,
  sunsetDocName,
  sunsetSwitchBlocker,
  type BillDetail,
  type BillLine,
  type PaveConfig,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { diffFields, openJournal, type Journal } from "@/lib/financialJournal";
import { readQboState } from "@/lib/qboLock";
import { isSalesTaxLine } from "@/lib/salesTax";

// The bulk switch for draft Sunset bills (Sunset Statements page).
//
// Sunset is paid in bulk off its monthly statement, from Banner Bank, so its
// bills are Expenses paid from "Checking - Banner Bank", and its credits are
// JobTread Credits (owner, 2026-10-23). The intake now files them that way;
// this turns the drafts filed before that into the same thing.
//
//   GET   → the draft Sunset bills not yet filed that way. Read-only.
//   POST  { docIds } → switch each one. Each bill is re-read first and skipped
//         unless it is still a draft Sunset bill not in QuickBooks. A bill gets
//         name Expense + Push as Expense + Banner Bank; a credit gets name
//         Credit only, so JobTread's vendor-credit push is left as it is.
//         A bill with a purchase AND a return is split first (splitSunsetLines):
//         its returns move onto a new Credit "<invoice #>-CR", with the same
//         file, and the purchases left behind become the Expense. Every change
//         is journalled. Dates are never touched.
//
// The page sends the ids in small batches, so one call stays well inside the
// function's time limit.
export const maxDuration = 60;

const MAX_PER_CALL = 15;

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const bills = await getDraftSunsetBills(getPaveConfig());
    return NextResponse.json({ ok: true, bills });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

interface Outcome {
  docId: string;
  ok: boolean;
  /** Why it was left alone, or why the write failed. */
  reason?: string;
  /** The Credit a split created (or found from an earlier, interrupted run). */
  creditDocId?: string;
  /** Done, but something needs a person — e.g. the file did not copy. */
  warning?: string;
}

/**
 * Move a mixed bill's returns onto their own Credit. The Credit is created (or
 * found, when an earlier run was interrupted) BEFORE any line comes off the
 * original — a failure part-way leaves a return counted twice, which the
 * statement reconcile shows, never a return lost. Throws when a line could not
 * be deleted, naming it.
 */
async function splitReturnsOff(
  cfg: PaveConfig,
  j: Journal,
  docId: string,
  accountId: string,
  detail: BillDetail,
  returns: BillLine[],
): Promise<{ creditDocId: string; warning?: string }> {
  const sourceExt = (detail.header.externalId ?? "").trim() || docId;
  let creditDocId = (await findBillByExternalId(cfg, accountId, sunsetCreditExternalId(sourceExt))) ?? "";
  let warning: string | undefined;

  if (!creditDocId) {
    const job = await getJobHeaderInfo(cfg, detail.jobId);
    const created = await createSunsetCredit(cfg, {
      jobId: detail.jobId,
      accountId,
      subject: detail.header.subject || `${job.name} - Sunset Builders Supply`,
      externalId: sourceExt,
      issueDate: String(detail.header.issueDate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      jobLocationName: job.name || undefined,
      jobLocationAddress: job.address || undefined,
      pushToQuickBooks: !detail.header.qboIsIgnored,
      lines: returns.map((l) => ({
        name: (l.name || "Return").substring(0, 250),
        description: l.description ?? "",
        unitCost: Number(l.unitCost) || 0,
        quantity: Number(l.quantity) || 0,
        isTaxable: true,
        jobCostItemId: l.jobCostItem?.id || undefined,
        costCode: l.costCode?.number || undefined,
      })),
    });
    creditDocId = created.id;
    await j.record([
      {
        action: "bill.create",
        entity: "bill",
        entityId: creditDocId,
        docId: creditDocId,
        jobId: detail.jobId,
        after: { vendor: "Sunset Builders Supply", externalId: created.externalId, lines: returns.length },
        beforeSource: "none",
        amount: returns.reduce((s, l) => s + (Number(l.cost) || 0), 0),
        meta: { source: "sunset-return-split", splitFrom: docId },
      },
    ]);

    // The invoice's own file, so the Credit carries its backup too.
    const file = detail.files.find((f) => /pdf/i.test(f.type ?? "") || /\.pdf$/i.test(f.name ?? "")) ?? detail.files[0];
    try {
      if (!file?.url) throw new Error("the original has no file");
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`file download HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      await attachFileToDocument(
        cfg,
        creditDocId,
        bytes,
        file.type || res.headers.get("content-type") || "application/pdf",
        `${created.externalId}.pdf`,
      );
    } catch (e) {
      warning = `Credit created, but the invoice file was not copied onto it (${
        e instanceof Error ? e.message : "unknown error"
      }) — attach it in JobTread.`;
    }
  }

  // Now take the returns off the original, each one snapshotted first.
  for (const l of returns) {
    const prior = await getLineJournalSnapshot(cfg, l.id);
    const event = {
      action: "line.delete",
      entity: "line",
      entityId: l.id,
      docId,
      jobId: detail.jobId,
      before: prior ?? undefined,
      beforeSource: (prior ? "read" : "none") as "read" | "none",
      amount: prior?.cost ?? null,
      meta: { source: "sunset-return-split", movedTo: creditDocId },
    };
    try {
      await deleteLine(cfg, l.id);
      await j.record([event]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      await j.record([{ ...event, outcome: "error", error: message }]);
      throw new Error(
        `Credit ${creditDocId} holds the returns, but "${l.name ?? l.id}" is still on the original too ` +
          `(${message}). Delete it from the original in JobTread.`,
      );
    }
  }
  clearJobCostCaches(); // lines moved between documents
  return { creditDocId, warning };
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docIds = Array.isArray(body.docIds)
    ? [...new Set(body.docIds.map((d) => String(d ?? "").trim()).filter(Boolean))]
    : [];
  if (docIds.length === 0) return NextResponse.json({ error: "docIds required" }, { status: 400 });
  if (docIds.length > MAX_PER_CALL) {
    return NextResponse.json({ error: `At most ${MAX_PER_CALL} bills per call.` }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, results: [] });
  }

  const cfg = getPaveConfig();
  // One journal for the whole batch: one requestId reads back as one action.
  const j = await openJournal("/api/sunset-expense");
  const results: Outcome[] = [];

  for (const docId of docIds) {
    const prior = await getBillJournalSnapshot(cfg, docId);
    if (!prior) {
      results.push({ docId, ok: false, reason: "could not read the bill" });
      continue;
    }
    if (!isSunsetVendor({ id: prior.accountId, name: prior.accountName })) {
      results.push({ docId, ok: false, reason: "not a Sunset bill" });
      continue;
    }
    // The QuickBooks lock, fail closed: an unreadable id is a refusal.
    const qbo = await readQboState(cfg, { docId });
    if (qbo.unknown) {
      results.push({ docId, ok: false, reason: "could not check QuickBooks" });
      continue;
    }
    // Its lines, to see whether it carries a return beside a purchase.
    let detail: BillDetail;
    try {
      detail = await getBillDetail(cfg, docId);
    } catch {
      results.push({ docId, ok: false, reason: "could not read the bill's lines" });
      continue;
    }
    const split = splitSunsetLines(detail.lines, (l) => Number(l.cost) || 0, isSalesTaxLine);
    const blocker = sunsetSwitchBlocker({ ...prior, qboId: qbo.qboId, mixed: split.mixed });
    if (blocker) {
      results.push({ docId, ok: false, reason: blocker });
      continue;
    }

    let cost = prior.cost ?? 0;
    let creditDocId: string | undefined;
    let warning: string | undefined;
    if (split.mixed) {
      try {
        ({ creditDocId, warning } = await splitReturnsOff(
          cfg,
          j,
          docId,
          prior.accountId ?? "",
          detail,
          split.returns,
        ));
      } catch (e) {
        results.push({ docId, ok: false, reason: e instanceof Error ? e.message : "Unknown error" });
        continue;
      }
      cost = split.purchases.reduce((s, l) => s + (Number(l.cost) || 0), 0);
    }

    const fields: { name: string; qboDocumentType?: string } =
      sunsetDocName(cost) === "Credit"
        ? { name: "Credit" }
        : { name: "Expense", qboDocumentType: "purchase" };
    const base = {
      action: "bill.fields.set",
      entity: "bill",
      entityId: docId,
      docId,
      jobId: prior.jobId,
      beforeSource: "read" as const,
    };
    try {
      const { saved } = await setBillFields(cfg, docId, fields, {
        expenseAccountId: QBO_SUNSET_EXPENSE_ACCOUNT_ID,
      });
      await j.record(diffFields(prior, { ...saved }, base));
      results.push({ docId, ok: true, creditDocId, warning });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      await j.record(
        diffFields(prior, fields, base).map((ev) => ({ ...ev, outcome: "error" as const, error: message })),
      );
      results.push({ docId, ok: false, reason: message, creditDocId });
    }
  }

  return NextResponse.json({ wrote: true, results });
}
