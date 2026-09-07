import { NextResponse } from "next/server";
import { getJobGantt } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: one job's Gantt bars — the JobTread schedule GROUPS (phases) and
 * the span they sit in (see getJobGantt). Fetched by the home board's drilldown
 * when someone actually opens a card, the same way /api/jobs/cost-detail is.
 *
 * `{ gantt: null }` when the job has nothing dated in JobTread — the caller
 * renders nothing rather than an empty chart.
 */
export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  try {
    return NextResponse.json({ gantt: await getJobGantt(getPaveConfig(), jobId) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
