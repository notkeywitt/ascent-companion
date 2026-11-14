import { NextRequest, NextResponse } from "next/server";
import { getUninvoicedBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// GET ?jobId= — individual uninvoiced bills (what a new draft will pull).
export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Pass jobId" }, { status: 400 });
  }
  const year = Number(req.nextUrl.searchParams.get("year")) || undefined;
  const month = Number(req.nextUrl.searchParams.get("month")) || undefined;
  // Omit year/month to span all months; includeInvoiced=1 also shows bills
  // already on a customer invoice; includeDrafts=1 also shows still-coding draft
  // bills. All driven by the Invoicing-tab toggles.
  const includeInvoiced = req.nextUrl.searchParams.get("includeInvoiced") === "1";
  const includeDrafts = req.nextUrl.searchParams.get("includeDrafts") === "1";
  try {
    const data = await getUninvoicedBills(
      getPaveConfig(),
      jobId,
      year,
      month,
      includeInvoiced,
      includeDrafts,
    );
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

// NOTE: invoice CREATION is POST /api/invoice-draft, not this route. One
// createDocument with `lineItems` and `references` builds the draft and sets
// the bill↔invoice link (scripts/probe-invoice-create.mjs, 2026-11-13); that
// route re-reads every reference and voids a draft that missed one.
