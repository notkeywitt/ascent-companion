import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { rangeFromUrl, scheduledJobs } from "@/lib/toolScheduleData";
import { setJobExcluded } from "@/lib/toolScheduleStore";

/**
 * Jobs the tool schedule reads, and the ones the office left out. A PreCon job
 * that carries a copy of another job's Gantt ("Studio PreCon") would double
 * that job's tool needs, so it can be left out here.
 *
 *   GET [?months=6]                       → { jobs: [{ id, name, excluded, tasks }] }
 *   PUT { jobId, jobName, excluded }      → { ok }
 *
 * Gated by the "tool-schedule-edit" view (office + admin).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const { from, to } = rangeFromUrl(new URL(req.url));
  try {
    return NextResponse.json({ jobs: await scheduledJobs(from, to) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can change which jobs count." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const jobId = String(b?.jobId ?? "");
  if (!jobId) return NextResponse.json({ error: "Pass jobId." }, { status: 400 });
  try {
    await setJobExcluded(jobId, String(b?.jobName ?? "").slice(0, 200), b?.excluded === true, u.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
