import { NextRequest, NextResponse } from "next/server";
import { getDraftBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Read-only (Phase A): list a job's draft vendor bills = the coding queue.
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
    const bills = await getDraftBills(getPaveConfig(), jobId);
    return NextResponse.json({ bills });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
