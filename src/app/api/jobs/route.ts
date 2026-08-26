import { NextRequest, NextResponse } from "next/server";

import { getCachedJobs, getCachedJobsWithPhase } from "@/lib/jobsCache";
import { hasGrant } from "@/lib/config";

// The two cache entries live in lib/jobsCache so a server component can preload
// the same list into its HTML and share this route's Data Cache entry (see
// /employee-time/page.tsx), instead of every page paying for a client fetch.

// Read-only: the org's open jobs, for the project picker. ?withPhase=1 joins
// each job's Phase custom field for callers that filter by it.
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const withPhase = req.nextUrl.searchParams.get("withPhase") === "1";
    const jobs = await (withPhase ? getCachedJobsWithPhase() : getCachedJobs());
    return NextResponse.json({ jobs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
