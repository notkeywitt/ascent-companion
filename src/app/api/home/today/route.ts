import { NextResponse } from "next/server";

import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { DIGEST_SETTINGS } from "@/lib/digest/settings";
import { eventWhen } from "@/lib/digest/checks/calendarEvents";
import { getUpcomingScheduleTasks } from "@/lib/jobtread";
import { orgDay } from "@/lib/orgTime";

/**
 * GET /api/home/today → { day, events, schedule } — Home's Today strip.
 *
 * Two reads, side by side: the shared office calendars (the same read-only
 * Apps Script call and calendar list the digest's calendar check uses), and
 * the JobTread schedule tasks that run through today. Either half that fails
 * comes back empty with its own error, so one outage never hides the other.
 *
 * Gated by the `home` view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

interface CalEvent {
  title?: string;
  location?: string;
  allDay?: boolean;
  start?: string;
  day?: string;
  startLabel?: string;
  endLabel?: string;
  calendarName?: string;
}

export async function GET() {
  const day = orgDay(new Date().toISOString());
  const cal = DIGEST_SETTINGS["calendar-events"].config;

  const [calRes, tasksRes] = await Promise.allSettled([
    callAppsScript<{ ok?: boolean; error?: string; events?: CalEvent[] }>(
      {
        action: "digestCalendar",
        days: 1,
        calendarIds: cal.calendarIds,
        calendarNames: cal.calendarNames,
        includePrimary: cal.includePrimary,
      },
      { timeoutMs: 15_000 },
    ),
    hasGrant() ? getUpcomingScheduleTasks(getPaveConfig(), day, day) : Promise.resolve([]),
  ]);

  const calData = calRes.status === "fulfilled" ? calRes.value : null;
  const calError =
    calRes.status === "rejected" ? String(calRes.reason) : calData?.error || (calData?.data?.ok === false ? calData.data.error : "");
  const events = (calData?.data?.events ?? [])
    .filter((e) => !e.day || e.day === day)
    .map((e) => ({
      title: e.title || "(no title)",
      when: eventWhen(e),
      allDay: !!e.allDay,
      start: e.start ?? "",
      where: e.location ?? "",
      calendar: e.calendarName ?? "",
    }));

  const schedule =
    tasksRes.status === "fulfilled"
      ? tasksRes.value.map((t) => ({ id: t.id, name: t.name, jobId: t.jobId, jobName: t.jobName, phase: t.phase }))
      : [];

  return NextResponse.json({
    day,
    events,
    schedule,
    errors: {
      calendar: calError || "",
      schedule: tasksRes.status === "rejected" ? String(tasksRes.reason) : "",
    },
  });
}
