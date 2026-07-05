import { NextRequest, NextResponse } from "next/server";
import { getBillLines, getJobBudget } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Read-only: a draft bill's lines + the job's budget (for the cost-code dropdown).
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
    const [lines, budget] = await Promise.all([getBillLines(cfg, docId), getJobBudget(cfg, jobId)]);
    return NextResponse.json({ lines, budget });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
