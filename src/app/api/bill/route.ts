import { NextRequest, NextResponse } from "next/server";
import { getBillDetail, getBillFiles, getJobBudget, getCostToComplete, scanJobCostItems } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// Read-only: a draft bill's header + lines + attached files + the job's budget.
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json(
      { error: "JT_GRANT_KEY is not set. Add it to .env.local and restart." },
      { status: 400 },
    );
  }
  const docId = req.nextUrl.searchParams.get("docId")?.trim();
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!docId || !jobId) {
    return NextResponse.json({ error: "Pass ?docId=<bill id>&jobId=<job id>" }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    // One paginated pass over job.costItems feeds BOTH budget and cost-to-
    // complete (they used to scan the same connection twice per bill open).
    const [detail, files, costItems] = await Promise.all([
      getBillDetail(cfg, docId),
      getBillFiles(cfg, docId),
      scanJobCostItems(cfg, jobId),
    ]);
    const [budget, costToComplete] = await Promise.all([
      getJobBudget(cfg, jobId, costItems),
      getCostToComplete(cfg, jobId, costItems),
    ]);
    return NextResponse.json({
      header: detail.header,
      lines: detail.lines,
      budget,
      files,
      costToComplete,
      writesEnabled: writesEnabled(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
