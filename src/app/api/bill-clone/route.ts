import { NextRequest, NextResponse } from "next/server";

import {
  canReclone,
  checkAgainstStatements,
  hasLiveClone,
  invoiceKey,
  monthRange,
  planClones,
  type ClonePair,
  type StatementLine,
} from "@/lib/billClone";
import { callAppsScript } from "@/lib/appsScript";
import { journalBillWrite } from "@/lib/billJournal";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import {
  clearJobCostCaches,
  cloneVendorDocument,
  getVendorMonthDocs,
  getVendors,
  isSunsetVendor,
  setBillFields,
  setBillStatus,
} from "@/lib/jobtread";
import { readSunsetReconcile } from "@/lib/sunsetFindings";

// BILL CLONES (/bill-clone): re-file one vendor's month of Expenses as Bills
// (owner, 2026-11-16). Rules: src/lib/billClone.ts.
//
//   GET  ?vendorId&ym → every pair (Expense ↔ its "-B" clone), the extras, the
//        documents left alone, and — for Sunset — each clone checked against
//        that month's statements. Read-only.
//   POST { vendorId, ym, action, docIds } → one step for each ORIGINAL id. The
//        server re-reads the month and acts only on a pair at the right stage:
//          clone    no clone      → a draft copy of the original
//          toBill   cloned        → the copy becomes Bill / Push as Bill
//          approve  bill          → the copy is approved for payment, which
//                                   pushes it to QuickBooks. Refused while the
//                                   copy differs from the original.
//          void     approved      → the ORIGINAL is voided in JobTread (status
//                                   denied, via appscript voidBill). Refused
//                                   until the copy is in QuickBooks.
//          reclone  a draft copy on   → the wrong copy is voided, and a new copy
//                   another job         is made from the original, on its job
//                                       with its coding. One row at a time.
//
// Clone refuses an original that already has a live "-B" copy anywhere in the
// month, whatever the pairing says: a second copy would push twice.
//
// The void skips the QuickBooks lock (src/lib/qboLock.ts) on purpose: the owner
// chose, 2026-11-16, to void these Expenses in JobTread and delete them in
// QuickBooks by hand. Nothing here deletes a document.
export const maxDuration = 120;

const MAX_PER_CALL = 5;
const ACTIONS = ["clone", "toBill", "approve", "void", "reclone"] as const;
type Action = (typeof ACTIONS)[number];
const STAGE_FOR: Record<Exclude<Action, "reclone">, ClonePair["stage"]> = {
  clone: "no clone",
  toBill: "cloned",
  approve: "bill",
  void: "approved",
};

async function vendorOf(vendorId: string) {
  const vendors = await getVendors(getPaveConfig());
  return vendors.find((v) => v.id === vendorId) ?? null;
}

/** The month's Sunset statement lines, from the appscript reconcile. */
async function sunsetStatementLines(ym: string): Promise<StatementLine[]> {
  const [y, m] = ym.split("-").map(Number);
  const resp = await readSunsetReconcile();
  const recon = (resp.reconciliation ?? {}) as Record<string, any>;
  const lines: StatementLine[] = [];
  for (const [expId, rc] of Object.entries(recon)) {
    if (Number(rc?.month) !== m || Number(rc?.year) !== y) continue;
    const match = rc?.match;
    if (!match) continue;
    for (const it of [...(match.matched ?? []), ...(match.mismatched ?? []), ...(match.missing ?? [])]) {
      if (it?.isCredit || typeof it?.statementAmount !== "number" || !it?.number) continue;
      lines.push({ number: String(it.number), amount: it.statementAmount, statement: expId });
    }
  }
  return lines;
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const vendorId = (req.nextUrl.searchParams.get("vendorId") ?? "").trim();
  const ym = (req.nextUrl.searchParams.get("ym") ?? "").trim();
  const range = monthRange(ym);
  if (!vendorId || !range) return NextResponse.json({ error: "vendorId and ym (YYYY-MM) required" }, { status: 400 });
  try {
    const cfg = getPaveConfig();
    const [vendor, docs] = await Promise.all([
      vendorOf(vendorId),
      getVendorMonthDocs(cfg, vendorId, range.first, range.last),
    ]);
    const plan = planClones(docs);

    let statement: {
      ok: boolean;
      error?: string;
      lineCount?: number;
      byCloneId?: ReturnType<typeof checkAgainstStatements>["byCloneId"];
      unmatched?: StatementLine[];
    } | null = null;
    if (vendor && isSunsetVendor(vendor)) {
      try {
        const lines = await sunsetStatementLines(ym);
        const { byCloneId, unmatched } = checkAgainstStatements(plan.pairs, lines);
        // A line for a document this page leaves alone is not a gap.
        const skippedKeys = new Set(plan.skipped.map((d) => invoiceKey(d.externalId)));
        statement = {
          ok: true,
          lineCount: lines.length,
          byCloneId,
          unmatched: unmatched.filter((l) => !skippedKeys.has(invoiceKey(l.number))),
        };
      } catch (e) {
        statement = { ok: false, error: e instanceof Error ? e.message : "statement read failed" };
      }
    }
    return NextResponse.json({ ok: true, vendor, ...plan, statement });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}

type Cfg = ReturnType<typeof getPaveConfig>;

/** Void one document through appscript voidBill (payments off, status denied), journalled. */
async function voidDoc(cfg: Cfg, route: string, docId: string) {
  await journalBillWrite({
    route,
    action: "bill.void",
    cfg,
    docId,
    field: "status",
    priorField: "status",
    attempted: "denied",
    run: async () => {
      const res = await callAppsScript<{ ok?: boolean; error?: string }>(
        { action: "voidBill", docId, confirm: true },
        { timeoutMs: 100_000 },
      );
      if (res.error) throw new Error(res.error);
      if (!res.data?.ok) throw new Error(res.data?.error ?? "The void did not complete.");
      return res.data;
    },
    after: () => "denied",
  });
}

/** Copy one original, journalled as a bill.create. */
async function cloneJournalled(cfg: Cfg, route: string, docId: string, jobId: string) {
  const j = await openJournal(route);
  const made = await cloneVendorDocument(cfg, docId);
  await j.record([
    {
      action: "bill.create",
      entity: "bill",
      entityId: made.id,
      docId: made.id,
      jobId,
      after: { externalId: made.externalId, clonedFrom: docId },
      beforeSource: "none",
      amount: made.cost,
      meta: { source: "bill-clone", clonedFrom: docId },
    },
  ]);
}

interface Outcome {
  docId: string;
  ok: boolean;
  reason?: string;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  let body: { vendorId?: unknown; ym?: unknown; action?: unknown; docIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const vendorId = String(body.vendorId ?? "").trim();
  const ym = String(body.ym ?? "").trim();
  const action = body.action as Action;
  const range = monthRange(ym);
  const docIds = Array.isArray(body.docIds)
    ? [...new Set(body.docIds.map((d) => String(d ?? "").trim()).filter(Boolean))]
    : [];
  if (!vendorId || !range || !ACTIONS.includes(action) || docIds.length === 0) {
    return NextResponse.json({ error: "vendorId, ym, action and docIds required" }, { status: 400 });
  }
  if (docIds.length > (action === "reclone" || action === "void" ? 1 : MAX_PER_CALL)) {
    return NextResponse.json({ error: "Too many documents for one call." }, { status: 400 });
  }
  if (!writesEnabled()) return NextResponse.json({ previewed: true, wrote: false, results: [] });

  const cfg = getPaveConfig();
  const monthDocs = await getVendorMonthDocs(cfg, vendorId, range.first, range.last);
  const plan = planClones(monthDocs);
  const pairOf = new Map(plan.pairs.map((p) => [p.original.id, p]));
  const route = "/api/bill-clone";
  const results: Outcome[] = [];

  for (const docId of docIds) {
    const p = pairOf.get(docId);
    if (!p) {
      results.push({ docId, ok: false, reason: "not an Expense of this vendor and month" });
      continue;
    }
    if (action === "reclone" ? !canReclone(p) : p.stage !== STAGE_FOR[action]) {
      results.push({ docId, ok: false, reason: `skipped: at stage "${p.stage}"` });
      continue;
    }
    if (action === "clone" && hasLiveClone(monthDocs, p.original)) {
      results.push({ docId, ok: false, reason: "skipped: a copy already exists" });
      continue;
    }
    try {
      if (action === "reclone") {
        const wrong = p.clone!;
        await voidDoc(cfg, route, wrong.id);
        await cloneJournalled(cfg, route, docId, p.original.jobId);
      } else if (action === "clone") {
        await cloneJournalled(cfg, route, docId, p.original.jobId);
      } else if (action === "toBill") {
        const clone = p.clone!;
        if (clone.status !== "draft" || clone.qboId) throw new Error("the copy is no longer a draft");
        await journalBillWrite({
          route,
          action: "bill.fields.set",
          cfg,
          docId: clone.id,
          field: "qboDocumentType",
          priorField: "qboDocumentType",
          attempted: "bill",
          run: async () => (await setBillFields(cfg, clone.id, { name: "Bill", qboDocumentType: "bill" })).saved,
          after: (saved) => saved.qboDocumentType,
        });
      } else if (action === "approve") {
        const clone = p.clone!;
        if (p.differences.length) throw new Error(`the copy differs: ${p.differences.join(", ")}`);
        // A Bill is approved for payment: draft → pending, which pushes it.
        await journalBillWrite({
          route,
          action: "bill.status.set",
          cfg,
          docId: clone.id,
          field: "status",
          priorField: "status",
          attempted: "pending",
          run: () => setBillStatus(cfg, clone.id, "pending"),
          after: (saved) => saved,
        });
      } else {
        const clone = p.clone!;
        if (!clone.qboId) throw new Error("the copy is not in QuickBooks yet — try again in a minute");
        await voidDoc(cfg, route, docId);
      }
      results.push({ docId, ok: true });
    } catch (e) {
      results.push({ docId, ok: false, reason: e instanceof Error ? e.message : "Unknown error" });
    }
  }
  clearJobCostCaches();
  return NextResponse.json({ wrote: true, results });
}
