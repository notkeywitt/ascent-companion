import { NextRequest, NextResponse } from "next/server";
import {
  getBillJournalSnapshot,
  getDraftSunsetBills,
  isSunsetVendor,
  QBO_SUNSET_EXPENSE_ACCOUNT_ID,
  setBillFields,
  sunsetDocName,
  sunsetSwitchBlocker,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { diffFields, openJournal } from "@/lib/financialJournal";
import { readQboState } from "@/lib/qboLock";

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
//         Every change is journalled. Never touches lines or dates.
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
    const blocker = sunsetSwitchBlocker({ ...prior, qboId: qbo.qboId });
    if (blocker) {
      results.push({ docId, ok: false, reason: blocker });
      continue;
    }

    const fields: { name: string; qboDocumentType?: string } =
      sunsetDocName(prior.cost) === "Credit"
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
      results.push({ docId, ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      await j.record(
        diffFields(prior, fields, base).map((ev) => ({ ...ev, outcome: "error" as const, error: message })),
      );
      results.push({ docId, ok: false, reason: message });
    }
  }

  return NextResponse.json({ wrote: true, results });
}
