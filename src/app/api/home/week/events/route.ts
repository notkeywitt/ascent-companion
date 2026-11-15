import { NextResponse } from "next/server";

import { callAppsScript } from "@/lib/appsScript";
import { DIGEST_SETTINGS } from "@/lib/digest/settings";
import { eventWhen } from "@/lib/digest/checks/calendarEvents";
import { dedupeEvents } from "@/lib/home/dedupeEvents";
import { orgDay } from "@/lib/orgTime";
import { weekDates } from "@/lib/weekActivity";

/**
 * GET /api/home/week/events → { events } — the shared office calendars for the
 * rest of this week, for the This Week widget. Read-only: the same Apps Script
 * call and calendar list as the digest's calendar check (the script holds
 * calendar.readonly).
 *
 * The Apps Script read starts at today, so days already gone this week show no
 * events. Its own route, so a slow script never holds up the week's bars.
 * Gated by the `home` view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

interface CalEvent {
  iCalUID?: string;
  id?: string;
  title?: string;
  location?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  day?: string;
  startLabel?: string;
  endLabel?: string;
  calendarName?: string;
}

export async function GET() {
  const today = orgDay(new Date().toISOString());
  const dates = weekDates(today);
  const cal = DIGEST_SETTINGS["calendar-events"].config;
  const r = await callAppsScript<{ ok?: boolean; error?: string; events?: CalEvent[] }>(
    {
      action: "digestCalendar",
      days: 7 - dates.indexOf(today),
      calendarIds: cal.calendarIds,
      calendarNames: cal.calendarNames,
      includePrimary: cal.includePrimary,
    },
    { timeoutMs: 15_000 },
  ).catch((e: unknown) => ({ error: String(e), data: undefined }));
  const error = r.error || (r.data?.ok === false ? r.data.error : "");
  if (error) return NextResponse.json({ error, events: [] }, { status: 502 });

  const events = dedupeEvents(r.data?.events ?? [])
    .map((e) => ({
      day: e.day || orgDay(e.start),
      title: e.title || "(no title)",
      when: eventWhen(e),
      allDay: !!e.allDay,
      start: e.start ?? "",
      where: e.location ?? "",
      calendar: e.calendarName ?? "",
    }))
    .filter((e) => dates.includes(e.day))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  return NextResponse.json({ events });
}
