import { NextRequest, NextResponse } from "next/server";
import { findNewJobBillByExternalId } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: the bill on a job that carries an ExpID, for Email Invoices'
 * "Code this bill →" link. Gated by the `recode` view's `/api/trackingsheet`
 * prefix, the same view the link and the bill page ride.
 *
 * GET ?jobId=…&expId=… → { docId }  ("" while the push is still settling)
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const jobId = (p.get("jobId") ?? "").trim();
  const expId = (p.get("expId") ?? "").trim();
  if (!jobId || !expId) {
    return NextResponse.json({ error: "jobId and expId are required." }, { status: 400 });
  }
  try {
    return NextResponse.json({ docId: await findNewJobBillByExternalId(getPaveConfig(), jobId, expId) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
