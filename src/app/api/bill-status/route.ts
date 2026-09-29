import { NextRequest, NextResponse } from "next/server";
import {
  clearJobCostCaches,
  getBillJournalSnapshot,
  isExpenseDoc,
  setBillFields,
  setBillStatus,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { journalBillWrite } from "@/lib/billJournal";
import { qboLock } from "@/lib/qboLock";

const ALLOWED = ["draft", "pending", "approved"] as const;
type Status = (typeof ALLOWED)[number];

// Set a bill's status. "approved" = Approve for payment / Record payment (pushes
// to QuickBooks). Gated by the writes flag.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const status = body.status as Status;
  if (!docId || !ALLOWED.includes(status)) {
    return NextResponse.json(
      { error: `docId and status (${ALLOWED.join("|")}) required` },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, status });
  }
  const cfg = getPaveConfig();
  // Frozen once it is in QuickBooks — see src/lib/qboLock.ts.
  const locked = await qboLock(cfg, { docId });
  if (locked) return locked;
  try {
    // "Push as" decides what QuickBooks records, and leaving draft is what sends
    // the bill there. A bill can arrive here named Expense with "Push as" still
    // Bill — made that way elsewhere, or before the toggle wrote both — and the
    // bill page reads it as an Expense, so its toggle never re-saves it. Every
    // approval passes through here, so the two fields are made to agree here.
    if (status !== "draft") {
      const snap = await getBillJournalSnapshot(cfg, docId);
      if (snap && isExpenseDoc(snap) && (snap.qboDocumentType !== "purchase" || snap.name !== "Expense")) {
        await journalBillWrite({
          route: "/api/bill-status",
          action: "bill.fields.set",
          cfg,
          docId,
          field: "qboDocumentType",
          priorField: "qboDocumentType",
          attempted: "purchase",
          // setBillFields throws if JobTread keeps Push as Bill, which refuses
          // the approval rather than push an already-paid Expense as a payable.
          run: async () =>
            (
              await setBillFields(
                cfg,
                docId,
                snap.qboDocumentType === "purchase"
                  ? { name: "Expense" }
                  : { name: "Expense", qboDocumentType: "purchase" },
              )
            ).saved,
          after: (saved) => saved.qboDocumentType,
        });
      }
    }
    // "approved" is the moment a bill leaves this app for QuickBooks, so this
    // row is the journal's record of when a cost entered the books, and who
    // sent it.
    const saved = await journalBillWrite({
      route: "/api/bill-status",
      action: "bill.status.set",
      cfg,
      docId,
      field: "status",
      priorField: "status",
      attempted: status,
      run: () => setBillStatus(cfg, docId, status),
      after: (saved) => saved,
    });
    // approved/pending bills count toward cost-to-complete; drafts don't — so any
    // status change moves the job's actuals.
    clearJobCostCaches();
    return NextResponse.json({ wrote: true, status: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
