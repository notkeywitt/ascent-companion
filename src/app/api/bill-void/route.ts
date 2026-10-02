import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches } from "@/lib/jobtread";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, writesEnabled } from "@/lib/config";
import { journalBillWrite } from "@/lib/billJournal";
import { qboLock } from "@/lib/qboLock";

// "Delete" a bill — which VOIDS it, never deletes it (CLAUDE.md, "Never delete
// a bill"). Apps Script action "voidBill" does the three steps in a safe order:
// void in JobTread (payments off, status denied, verified), then remove the
// bill's Expenditure + lineItem rows, then trash its Drive PDF. Afterwards the
// bill exists only as a void in JobTread.
//
// POST /api/bill-void { docId } →
//   { ok, expId, paymentsRemoved, removedRow, removedLines, trashed } | { error }
export const maxDuration = 120;

type VoidResult = { ok?: boolean; error?: string };

export async function POST(req: NextRequest) {
  let body: { docId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const docId = String(body.docId ?? "").trim();
  if (!docId) return NextResponse.json({ error: "docId is required." }, { status: 400 });
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, error: "Writes are OFF. The bill was not voided." });
  }

  const cfg = getPaveConfig();
  // A bill already in QuickBooks is voided there, by hand — see src/lib/qboLock.ts.
  const locked = await qboLock(cfg, { docId });
  if (locked) return locked;

  try {
    // Journalled as a status change: denied is the void. A void is a write, so
    // the call is never retried.
    const data = await journalBillWrite({
      route: "/api/bill-void",
      action: "bill.void",
      cfg,
      docId,
      field: "status",
      priorField: "status",
      attempted: "denied",
      run: async () => {
        const res = await callAppsScript<VoidResult>(
          { action: "voidBill", docId, confirm: true },
          { timeoutMs: 110_000 },
        );
        if (res.error) throw new Error(res.error);
        if (!res.data?.ok) throw new Error(res.data?.error ?? "The void did not complete.");
        return res.data;
      },
      after: () => "denied",
    });
    clearJobCostCaches();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
