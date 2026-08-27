"use client";

import { useSearchParams } from "next/navigation";
import { Board } from "./Board";
import { AllJobs } from "./AllJobs";

/**
 * Tracking Sheets has two halves, and which one you get is decided by whether a
 * job is selected:
 *
 *   /trackingsheet            → the all-jobs views (this month's invoices, needs-coding queue)
 *   /trackingsheet?jobId=…    → the workbench for that job (budget rail, bills, coding drawer)
 *
 * The two used to be separate routes (/stage and /coding alongside /trackingsheet),
 * which meant the month's total, the bills behind it, and the budget you were
 * coding them against were three different pages. The job selector is the only
 * thing that ever distinguished them, so it's the thing that switches here.
 */
export function ClientInvoicing() {
  const jobId = (useSearchParams().get("jobId") ?? "").trim();
  return jobId ? <Board /> : <AllJobs />;
}
