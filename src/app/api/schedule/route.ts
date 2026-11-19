import { NextResponse } from "next/server";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getJobs, getUpcomingScheduleTasks } from "@/lib/jobtread";
import { addDays, daysBetween, isDay, MAX_WINDOW_DAYS } from "@/lib/scheduleGantt";

/**
 * GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD → the open schedule tasks on
 * any job that overlap that span, plus each job's customer. The Schedule page
 * (src/app/schedule) draws them as a Gantt. Read-only.
 *
 * Same read as the Tool Schedule and Home's This week card
 * (`getUpcomingScheduleTasks`, cached 5 minutes). It leaves out finished tasks.
 * A failed jobs read only drops the customer from the label.
 *
 * Gated by the `schedule` view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isDay(from) || !isDay(to)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD." }, { status: 400 });
  }
  const span = daysBetween(from, to);
  if (span < 0 || span >= MAX_WINDOW_DAYS) {
    return NextResponse.json(
      { error: `Ask for 1 to ${MAX_WINDOW_DAYS} days at a time.` },
      { status: 400 },
    );
  }
  try {
    const cfg = getPaveConfig();
    const [tasks, jobs] = await Promise.all([
      getUpcomingScheduleTasks(cfg, from, addDays(from, span)),
      getJobs(cfg).catch(() => []),
    ]);
    const customers: Record<string, string> = {};
    for (const j of jobs) if (j.customer) customers[j.id] = j.customer;
    return NextResponse.json({ from, to, tasks, customers });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
