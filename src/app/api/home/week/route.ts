import { NextResponse } from "next/server";
import { getPaveConfig, hasGrant } from "@/lib/config";
import {
  OFFICE_JOB_ID,
  getJobs,
  getOpenToDosCached,
  getUpcomingScheduleTasks,
} from "@/lib/jobtread";
import { orgDay } from "@/lib/orgTime";
import { buildWeekActivity, weekDates } from "@/lib/weekActivity";

/**
 * GET /api/home/week → this week's activity per job, Sunday to Saturday —
 * Home's week bars. Read-only.
 *
 * Three cached reads: the open schedule tasks that overlap the week, the org's
 * open to-dos, and the open jobs (for each job's customer, so a row reads
 * "Customer - Job"). How they become a count per job per day is
 * `buildWeekActivity` (src/lib/weekActivity.ts). A failed jobs read only drops
 * the customer from the label.
 *
 * `officeJobId` tells the widget which to-dos it may edit: the one to-do edit
 * route, PATCH /api/office/todos, refuses a to-do on any other job.
 *
 * "Today" is the ORG's day, not the server's (a Vercel lambda runs in UTC).
 * Gated by the `home` view (src/lib/views.ts), like every /api/home read.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const today = orgDay(new Date().toISOString());
    const dates = weekDates(today);
    const [tasks, todos, jobs] = await Promise.all([
      getUpcomingScheduleTasks(cfg, dates[0], dates[6]),
      getOpenToDosCached(cfg),
      getJobs(cfg).catch(() => []),
    ]);
    const customers = new Map(jobs.filter((j) => j.customer).map((j) => [j.id, j.customer!]));
    return NextResponse.json({
      ...buildWeekActivity(today, tasks, todos, customers),
      officeJobId: OFFICE_JOB_ID,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
