import { NextRequest, NextResponse } from "next/server";
import { setBillExternalId } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// Set a bill's Vendor Bill Number (JobTread's externalId, the vendor's invoice/
// bill number). An empty value clears it. Capped at JobTread's 32-char limit.
// Gated by the writes flag, like the other bill header edits.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; externalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const externalId = String(body.externalId ?? "").trim();
  if (!docId) {
    return NextResponse.json({ error: "docId required" }, { status: 400 });
  }
  if (externalId.length > 32) {
    return NextResponse.json(
      { error: "Bill number is limited to 32 characters." },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, externalId });
  }
  try {
    const saved = await setBillExternalId(getPaveConfig(), docId, externalId);
    return NextResponse.json({ wrote: true, externalId: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
