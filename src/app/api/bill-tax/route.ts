import { NextRequest, NextResponse } from "next/server";
import { setBillTax } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// Set a bill's document-level sales tax (nonRecoverableTax, a dollar amount).
// Gated by the writes flag: with writes OFF it previews and sends nothing to JT.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; taxAmount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const taxAmount = Number(body.taxAmount);
  if (!docId || !Number.isFinite(taxAmount) || taxAmount < 0) {
    return NextResponse.json(
      { error: "docId and a non-negative taxAmount are required" },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, taxAmount });
  }
  try {
    const saved = await setBillTax(getPaveConfig(), docId, taxAmount);
    return NextResponse.json({ wrote: true, taxAmount: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
