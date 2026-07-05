import { NextRequest, NextResponse } from "next/server";
import { getBillDetail, getBillFiles, getJobBudget } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

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
    const [detail, budget, files] = await Promise.all([
      getBillDetail(cfg, docId),
      getJobBudget(cfg, jobId),
      getBillFiles(cfg, docId),
    ]);
    return NextResponse.json({ header: detail.header, lines: detail.lines, budget, files });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
