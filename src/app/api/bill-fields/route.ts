import { NextRequest, NextResponse } from "next/server";
import {
  getBillJournalSnapshot,
  getVendorDetail,
  qboDocumentTypeFor,
  setBillFields,
  type BillType,
} from "@/lib/jobtread";
import { setVendorBillType } from "@/lib/clientDirectory";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { diffFields, openJournal } from "@/lib/financialJournal";
import { qboLock } from "@/lib/qboLock";

// Set a bill's header flags: its type (Bill | Expense) and/or qboIsIgnored
// (Push-to-QB = !qboIsIgnored). Gated by the writes flag.
//
// The type is ONE choice written to TWO fields — `name` and `qboDocumentType`
// ("Push as Bill" / "Push as Expense"); see BillType in lib/jobtread. Either key
// sets both. Assigning a type also makes it the vendor's default ("Bill Type"),
// so the next bill from them files the same way.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; name?: string; qboIsIgnored?: boolean; qboDocumentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

  const fields: { name?: string; qboIsIgnored?: boolean; qboDocumentType?: string } = {};
  if (body.name === "Bill" || body.name === "Expense") fields.name = body.name;
  if (typeof body.qboIsIgnored === "boolean") fields.qboIsIgnored = body.qboIsIgnored;
  // QBO sync type: bill (as a bill) or purchase (as an expense).
  if (body.qboDocumentType === "bill" || body.qboDocumentType === "purchase") {
    fields.qboDocumentType = body.qboDocumentType;
  }
  let billType: BillType | null = null;
  if (fields.name) billType = fields.name as BillType;
  else if (fields.qboDocumentType) billType = fields.qboDocumentType === "purchase" ? "Expense" : "Bill";
  if (billType) {
    fields.name = billType;
    fields.qboDocumentType = qboDocumentTypeFor(billType);
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, ...fields });
  }
  // `qboIsIgnored` decides whether this cost ever reaches QuickBooks — the
  // general ledger — so every flip of it is journalled with its prior value.
  // Multi-field write, so `diffFields` produces one row per field that actually
  // changed rather than a row per field sent.
  const cfg = getPaveConfig();
  // Frozen once it is in QuickBooks — see src/lib/qboLock.ts.
  const locked = await qboLock(cfg, { docId });
  if (locked) return locked;
  const j = await openJournal("/api/bill-fields");
  const prior = await getBillJournalSnapshot(cfg, docId);
  const base = {
    action: "bill.fields.set",
    entity: "bill",
    entityId: docId,
    docId,
    jobId: prior?.jobId ?? "",
    beforeSource: (prior ? "read" : "none") as "read" | "none",
  };
  try {
    const { saved, accountId } = await setBillFields(cfg, docId, fields);
    await j.record(diffFields(prior ?? undefined, { ...saved }, base));
    // The vendor's default follows the last assignment. A failure here leaves the
    // bill right and only the default stale, so it warns rather than fails.
    let vendorWarning = "";
    if (billType && accountId) {
      try {
        const was = (await getVendorDetail(cfg, accountId)).billType;
        if (was !== billType) {
          await setVendorBillType(cfg, accountId, billType);
          await j.record(
            diffFields({ "Bill Type": was }, { "Bill Type": billType }, {
              action: "vendor.billType.set",
              entity: "vendor",
              entityId: accountId,
              docId,
              jobId: prior?.jobId ?? "",
              beforeSource: "read",
            }),
          );
        }
      } catch (e) {
        vendorWarning = `Bill saved, but the vendor's default type was not: ${
          e instanceof Error ? e.message : "unknown error"
        }`;
      }
    }
    return NextResponse.json({ wrote: true, ...saved, vendorWarning });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await j.record(
      diffFields(prior ?? undefined, { ...fields }, base).map((ev) => ({
        ...ev,
        outcome: "error" as const,
        error: message,
      })),
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
