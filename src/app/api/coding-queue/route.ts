import { NextRequest, NextResponse } from "next/server";
import { getDraftBills, getAllDraftBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// Read-only (Phase A): draft vendor bills = the coding queue. With ?jobId=…,
// that job's drafts; with no job, every job's drafts (each tagged with its job).
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json(
      { error: "JT_GRANT_KEY is not set. Add it to .env.local and restart." },
      { status: 400 },
    );
  }
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  try {
    const cfg = getPaveConfig();
    const bills = jobId ? await getDraftBills(cfg, jobId) : await getAllDraftBills(cfg);
    return NextResponse.json({ bills });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
