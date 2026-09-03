import { NextResponse } from "next/server";
import { getOpenCustomerInvoices, jtIsoToOrgLocal } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { buildArAging } from "@/lib/arAging";

/**
 * ACCOUNTS RECEIVABLE AGEING — what clients owe, bucketed by how late it is.
 *
 * Read-only. Every figure is JobTread's own (`balance` and `amountPaid` are
 * derived by JobTread from QuickBooks), so this route fetches and buckets and
 * computes no money of its own — see `src/lib/arAging.ts`.
 *
 * "Today" is resolved in the ORG's timezone, not the server's. A Vercel lambda
 * runs in UTC, so after 4pm Pacific a UTC date would age every invoice a day
 * early and flip the ones sitting on a bucket boundary.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const rows = await getOpenCustomerInvoices(getPaveConfig());
    const today = jtIsoToOrgLocal(new Date().toISOString()).slice(0, 10);
    // Same deep-link shape the invoice review uses, so one invoice has one URL
    // in the codebase.
    const withUrls = rows.map((r) => ({
      ...r,
      jtUrl: `https://app.jobtread.com/jobs/${encodeURIComponent(r.jobId)}/documents/${encodeURIComponent(r.id)}`,
    }));
    return NextResponse.json(buildArAging(withUrls, today));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
