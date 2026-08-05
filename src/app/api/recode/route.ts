import { NextRequest, NextResponse } from "next/server";
import {
  getBillLinesForJob,
  getJobBillsForMonth,
  getJobBudget,
  getJobCostDetail,
  getJobHeaderInfo,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Read-only: everything the Invoicing coding board needs for ONE job in ONE
 * browser fetch — the month's bills, their individual lines, the droppable
 * coding targets, and the per-cost-code budget headroom.
 *
 * Assembled from functions that already exist and are already cached:
 *  - getUninvoicedBills — the month's bills (filters on issueDate within a plain
 *    calendar month, which IS the billing month; the 10th-to-10th rule is an
 *    ingestion convention, not a query).
 *  - getJobCostDetail  — per-cost-code budget/spent/invoiced (built for /jobs),
 *    which doubles as the board's compact tracking-sheet reference panel.
 *  - getJobBudget      — the budget leaves; their `id` is the jobCostItemId a
 *    recode targets, so this is the set of legal drop targets.
 *  - getBillLinesForJob — the only new query; one walk for every line on those
 *    bills rather than a getBillDetail per bill.
 *
 * Invoiced bills are deliberately excluded: recoding a bill already on a customer
 * invoice changes numbers the client has been sent.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const jobId = p.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });

  const year = Number(p.get("year")) || undefined;
  const month = Number(p.get("month")) || undefined;
  const includeDrafts = p.get("includeDrafts") !== "0"; // drafts on by default

  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;

  try {
    const cfg = getPaveConfig();

    // Bills first — their ids scope the line query. The other three don't depend
    // on it, so they run alongside.
    const [bills, budget, costDetail, header] = await Promise.all([
      getJobBillsForMonth(cfg, jobId, y, m, includeDrafts),
      getJobBudget(cfg, jobId),
      getJobCostDetail(cfg, jobId),
      getJobHeaderInfo(cfg, jobId),
    ]);
    const lines = await getBillLinesForJob(cfg, jobId, [...new Set(bills.map((b) => b.id))]);

    return NextResponse.json({
      job: { id: jobId, name: header.name, address: header.address },
      bills,
      billTotal: bills.reduce((s, b) => s + (b.cost ?? 0), 0),
      lines,
      budget,
      costDetail,
      writesEnabled: writesEnabled(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
