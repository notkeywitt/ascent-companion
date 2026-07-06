import { NextRequest, NextResponse } from "next/server";
import { setBillFields } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// Set a bill's header flags: name ("Bill"|"Expense") and/or qboIsIgnored
// (Push-to-QB = !qboIsIgnored). Gated by the writes flag.
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
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, ...fields });
  }
  try {
    const saved = await setBillFields(getPaveConfig(), docId, fields);
    return NextResponse.json({ wrote: true, ...saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
