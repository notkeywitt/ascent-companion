import { NextRequest, NextResponse } from "next/server";
import { getBillDetail, setBillDueDate } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { journalBillWrite } from "@/lib/billJournal";

/**
 * Set a bill's dueDate — JobTread's "Payment Due", the date the VENDOR's invoice
 * is due. NOT the billing month, which is `issueDate` (/api/bill-issuedate).
 *
 * An empty `dueDate` clears it and puts the bill back on net-30 terms, the same
 * fallback ingestion uses for an invoice that printed no due date.
 *
 * JobTread rejects a due date that precedes the issue date, so the bill's own
 * issue date is read first and an earlier date is refused HERE with a sentence a
 * person can act on, rather than as a raw Pave error.
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; dueDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const dueDate = (body.dueDate ?? "").trim();
  if (!docId) {
    return NextResponse.json({ error: "docId required" }, { status: 400 });
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json(
      { error: "dueDate must be YYYY-MM-DD, or empty to clear it" },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, dueDate });
  }
  const cfg = getPaveConfig();
  try {
    if (dueDate) {
      const issueDate = String((await getBillDetail(cfg, docId)).header.issueDate ?? "").slice(0, 10);
      // ISO strings compare chronologically — same guard as computeBillDates.
      if (issueDate && dueDate < issueDate) {
        return NextResponse.json(
          {
            error: `Due date ${dueDate} is before the bill's date ${issueDate}. JobTread will not accept it.`,
          },
          { status: 400 },
        );
      }
    }
    const saved = await journalBillWrite({
      route: "/api/bill-duedate",
      action: "bill.dueDate.set",
      cfg,
      docId,
      field: "dueDate",
      priorField: "dueDate",
      attempted: dueDate,
      run: () => setBillDueDate(cfg, docId, dueDate),
      after: (saved) => saved.dueDate,
    });
    return NextResponse.json({ wrote: true, ...saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
