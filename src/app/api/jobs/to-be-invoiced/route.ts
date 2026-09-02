import { NextResponse } from "next/server";

import { getCachedMonthlyInvoiceJobs, getCachedMonthlyInvoiceTime } from "@/lib/jobsCache";
import { hasGrant } from "@/lib/config";
import { deriveBillingPeriod } from "@/lib/billing";

// The scan pages every vendor bill AND every time entry the org logged in the
// month; give it the same headroom the other org-wide JobTread scans get.
export const maxDuration = 60;

/**
 * Read-only: what each job still has to invoice this billing month, keyed by job
 * id — what the header's job picker prints beside each job.
 *
 * The figure is uninvoiced BILLS + uninvoiced TIME, the same sum a job's own
 * card produces (`getUninvoicedBills`), because a client invoice pulls logged
 * labor along with the vendor bills. Bills alone read low on every job the crew
 * worked, which is what this endpoint used to return.
 *
 * The month is the CURRENT billing month, derived through the one billing-period
 * rule (`deriveBillingPeriod`): through the 10th we're still closing out the
 * previous month. That is the same window Tracking Sheets opens on, so the
 * picker's figures and that page's cards read the same month.
 *
 * The two walks are independent and reported as such: if the time walk fails,
 * `includesTime` comes back false and the totals are still the bills, rather
 * than the picker losing its amounts altogether. A job with nothing to invoice
 * is simply absent from `totals`.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const { billingYear, billingMonthNum } = deriveBillingPeriod(new Date(), false);
  const [billsRes, timeRes] = await Promise.allSettled([
    getCachedMonthlyInvoiceJobs(billingYear, billingMonthNum),
    getCachedMonthlyInvoiceTime(billingYear, billingMonthNum),
  ]);

  if (billsRes.status === "rejected") {
    const e = billsRes.reason;
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const totals: Record<string, number> = {};
  for (const j of billsRes.value) totals[j.jobId] = j.billTotal;
  // A job can have time this month and no bills at all — add it, don't just
  // top up the jobs the bill scan already found.
  if (timeRes.status === "fulfilled") {
    for (const [jobId, cost] of Object.entries(timeRes.value)) {
      totals[jobId] = (totals[jobId] ?? 0) + cost;
    }
  }

  return NextResponse.json({
    ym: `${billingYear}-${String(billingMonthNum).padStart(2, "0")}`,
    totals,
    includesTime: timeRes.status === "fulfilled",
  });
}
