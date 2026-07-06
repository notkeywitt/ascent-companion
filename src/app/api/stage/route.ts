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
  try {
    const data = await getUninvoicedBills(getPaveConfig(), jobId, year, month);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

// NOTE: invoice CREATION is intentionally not an API write. JobTread builds an
// invoice from unbilled items via a multi-call server-side flow that also sets
// the bill↔invoice link; reproducing it risks double-billing. The Invoicing tab
// instead deep-links to JobTread's native builder (see stage/page.tsx).
