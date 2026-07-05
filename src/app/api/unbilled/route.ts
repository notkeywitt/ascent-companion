import { NextRequest, NextResponse } from "next/server";
import { getJobDocumentRollup, computeUnbilled } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Read-only: a job's cost/price rollup by document type+status, plus the
// computed unbilled headline (Σ approved bill cost − Σ invoice cost).
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json(
      { error: "JT_GRANT_KEY is not set. Add it to .env.local and restart." },
      { status: 400 },
    );
  }
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Pass ?jobId=<JobTread job id>" }, { status: 400 });
  }
  try {
    const rollup = await getJobDocumentRollup(getPaveConfig(), jobId);
    return NextResponse.json({ rollup, summary: computeUnbilled(rollup) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
