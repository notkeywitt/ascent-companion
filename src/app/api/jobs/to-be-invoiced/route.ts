import { NextResponse } from "next/server";

import { getCachedMonthlyInvoiceJobs } from "@/lib/jobsCache";
import { hasGrant } from "@/lib/config";
import { deriveBillingPeriod } from "@/lib/billing";

// The scan pages every vendor bill the org issued in the month; give it the same
// headroom the other org-wide JobTread scans get.
export const maxDuration = 60;

/**
 * Read-only: what each job still has to invoice this billing month, keyed by job
 * id — what the header's job picker prints beside each job.
 *
 * The month is the CURRENT billing month, derived through the one billing-period
 * rule (`deriveBillingPeriod`): through the 10th we're still closing out the
 * previous month. That is the same window Tracking Sheets opens on, so the
 * picker's figures and that page's cards read the same month.
 *
 * A job with nothing to invoice is simply absent from `totals`.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const { billingYear, billingMonthNum } = deriveBillingPeriod(new Date(), false);
  try {
    const jobs = await getCachedMonthlyInvoiceJobs(billingYear, billingMonthNum);
    const totals: Record<string, number> = {};
    for (const j of jobs) totals[j.jobId] = j.billTotal;
    return NextResponse.json({
      ym: `${billingYear}-${String(billingMonthNum).padStart(2, "0")}`,
      totals,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
