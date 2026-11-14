import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { billSplits } from "@/db/schema";
import { clearJobCostCaches, getBillDetail } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import { qboLock } from "@/lib/qboLock";
import { splitBill } from "@/lib/splitBill";
import { checkSplit, splitFamily } from "@/lib/splitCheck";

/**
 * Split a draft bill in two: the picked lines move to a new draft bill on the
 * same job, with the same vendor and dates, invoice number "<original>-2", and a
 * copy of the PDF (src/lib/splitBill.ts).
 *
 *   POST { docId, lineIds: string[] } → { newDocId, externalId, filesCopied, fileErrors }
 *
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true this writes nothing
 * and returns a preview, matching /api/buyback and /api/delete-line. Each moved
 * line goes in the financial journal as the original's delete and the new
 * bill's add, so the split can be traced and undone by hand.
 *
 * Each split also records a `bill_splits` row in the companion DB (App
 * Feedback #6). GET ?docId= reads it back: the bill's split family and whether
 * the pieces' current totals and line counts still match the original.
 *   GET ?docId= → { split: null } | { split: { pieces, originalTotal, originalLineCount, ...SplitCheck } }
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  let body: { docId?: string; lineIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const docId = String(body.docId ?? "").trim();
  const lineIds = Array.isArray(body.lineIds) ? body.lineIds.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!docId || lineIds.length === 0) {
    return NextResponse.json({ error: "docId and lineIds are required." }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was split in JobTread.",
    });
  }

  const cfg = getPaveConfig();
  // The original loses lines, so it must not be in QuickBooks — src/lib/qboLock.ts.
  const locked = await qboLock(cfg, { docId });
  if (locked) return locked;
  const j = await openJournal("/api/split-bill");
  try {
    const r = await splitBill(cfg, docId, lineIds);
    clearJobCostCaches();
    await recordSplitLink(docId, r.newDocId, r.originalTotal, r.originalLineCount);
    await j.record(
      r.moved.map((l) => ({
        action: "bill.split",
        entity: "line",
        entityId: l.id,
        docId,
        field: "",
        before: { docId, ...l },
        after: { docId: r.newDocId, externalId: r.externalId },
        beforeSource: "read" as const,
        amount: l.cost,
        meta: { newDocId: r.newDocId },
      })),
    );
    return NextResponse.json({
      previewed: false,
      wrote: true,
      newDocId: r.newDocId,
      externalId: r.externalId,
      filesCopied: r.filesCopied,
      fileErrors: r.fileErrors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await j.record([{ action: "bill.split", entity: "bill", entityId: docId, docId, outcome: "error", error: message }]);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** The split is already in JobTread; a failed link row must not report it as failed. */
async function recordSplitLink(originalDocId: string, newDocId: string, originalTotal: number, originalLineCount: number) {
  try {
    let email = "";
    try {
      email = (await auth())?.user?.email ?? "";
    } catch {
      /* best-effort — createdBy is optional */
    }
    await ensureDb();
    await db.insert(billSplits).values({
      newDocId,
      originalDocId,
      originalTotal,
      originalLineCount,
      createdBy: email,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[split-bill] link row not saved", e);
  }
}

export async function GET(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get("docId")?.trim();
  if (!docId) return NextResponse.json({ error: "Pass ?docId=<bill id>" }, { status: 400 });
  try {
    await ensureDb();
    // ponytail: whole-table read, one row per split ever made; index by doc id if it grows large.
    const family = splitFamily(await db.select().from(billSplits), docId);
    if (!family) return NextResponse.json({ split: null });
    if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
    const cfg = getPaveConfig();
    const pieces = await Promise.all(
      family.pieceIds.map(async (id) => {
        const d = await getBillDetail(cfg, id);
        const total = d.lines.reduce((s, l) => s + (typeof l.cost === "number" ? l.cost : 0), 0);
        return { docId: id, externalId: d.header.externalId ?? "", status: d.header.status ?? "", total, lineCount: d.lines.length };
      }),
    );
    return NextResponse.json({
      split: {
        rootId: family.rootId,
        originalTotal: family.originalTotal,
        originalLineCount: family.originalLineCount,
        pieces,
        ...checkSplit(family, pieces),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
