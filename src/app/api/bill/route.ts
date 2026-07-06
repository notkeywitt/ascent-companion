import { NextRequest, NextResponse } from "next/server";
import { getBillDetail, getBillFiles, getJobBudget, getCostToComplete } from "@/lib/jobtread";
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
    const [detail, budget, files, costToComplete] = await Promise.all([
      getBillDetail(cfg, docId),
      getJobBudget(cfg, jobId),
      getBillFiles(cfg, docId),
      getCostToComplete(cfg, jobId),
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
