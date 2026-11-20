import { NextResponse } from "next/server";
import { getClientBudgetInputs } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { buildClientBudget } from "@/lib/clientBudget";
import { readDeposits } from "@/lib/depositRead";

/**
 * Read-only: the client budget report for one job through one billing month —
 * budget, billed to date, remaining, % invoiced and cost to complete by cost
 * code, plus the job's deposit block. GET ?jobId=<id>&month=YYYY-MM.
 * Gated by the `client-budget` view.
 */
export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const q = new URL(req.url).searchParams;
  const jobId = q.get("jobId");
  const m = /^(\d{4})-(\d{2})$/.exec(q.get("month") ?? "");
  if (!jobId || !m) {
    return NextResponse.json({ error: "jobId and month (YYYY-MM) are required." }, { status: 400 });
  }
  try {
    const [read, deposits] = await Promise.all([
      getClientBudgetInputs(getPaveConfig(), jobId, Number(m[1]), Number(m[2])),
      // The deposit block is optional: a failed read drops the block, not the report.
      readDeposits(jobId).catch(() => null),
    ]);
    const ledger = deposits?.ledger;
    return NextResponse.json({
      jobName: read.jobName,
      customer: read.customer,
      budgetBasis: read.budgetBasis,
      report: buildClientBudget(read.inputs),
      deposit:
        ledger?.hasDeposit && ledger.source
          ? { deposit: ledger.deposit, applied: ledger.previouslyApplied + ledger.drawn, left: ledger.left }
          : null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
