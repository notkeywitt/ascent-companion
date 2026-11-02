import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import { qboLock } from "@/lib/qboLock";
import { splitBill } from "@/lib/splitBill";

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
