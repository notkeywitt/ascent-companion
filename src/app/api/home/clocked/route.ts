import { NextResponse } from "next/server";

import { getPaveConfig, hasGrant } from "@/lib/config";
import { getOrgTimeEntries } from "@/lib/jobtread";

/**
 * GET /api/home/clocked → { ok, jobs: [{ jobId, jobName, people: [{ name, code }] }] } — who is
 * clocked in right now, grouped by job, for Home's "Clocked in" map card.
 * READ-ONLY: open time entries (`endedAt` null) from the last 3 days, so a
 * clock forgotten for weeks does not show as live.
 *
 * Gated by the `home` view (src/lib/views.ts, prefix /api/home).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const open = await getOrgTimeEntries(getPaveConfig(), { openOnly: true, sinceIso: since });
    const byJob = new Map<string, { jobId: string; jobName: string; people: { name: string; code: string }[] }>();
    for (const e of open) {
      if (!e.jobId) continue;
      const j = byJob.get(e.jobId) ?? {
        jobId: e.jobId,
        jobName: e.customer ? `${e.customer} - ${e.jobName}` : e.jobName,
        people: [],
      };
      const code = [e.costCode, e.costItemName].filter(Boolean).join(" ");
      if (e.userName && !j.people.some((p) => p.name === e.userName && p.code === code)) {
        j.people.push({ name: e.userName, code });
      }
      byJob.set(e.jobId, j);
    }
    return NextResponse.json({ ok: true, jobs: [...byJob.values()].sort((a, b) => a.jobName.localeCompare(b.jobName)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
