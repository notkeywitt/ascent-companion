import { NextRequest, NextResponse } from "next/server";
import { getInvoiceReconciliation } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// GET ?jobId=&year=&month= — the customer invoice(s) created in JobTread for a
// job + billing month (links + totals), plus a completeness check: is every
// finalized bill and uninvoiced time entry for the month actually on a live
// (non-denied) invoice? Backs the Invoicing tab's per-card reconciliation.
export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!jobId || !year || !month) {
    return NextResponse.json({ error: "Pass jobId, year, and month" }, { status: 400 });
  }
  try {
    const data = await getInvoiceReconciliation(getPaveConfig(), jobId, year, month);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
