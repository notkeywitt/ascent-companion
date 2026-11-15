import { NextResponse } from "next/server";

import { callAppsScript } from "@/lib/appsScript";
import { DIGEST_SETTINGS } from "@/lib/digest/settings";
import { eventWhen } from "@/lib/digest/checks/calendarEvents";
import { dedupeEvents } from "@/lib/home/dedupeEvents";
import { orgDay } from "@/lib/orgTime";
import { nextDates } from "@/lib/weekActivity";

/**
 * GET /api/home/week/events → { events } — the shared office calendars for the
 * next seven days, today first, for the This week card. Read-only: the same
 * Apps Script call and calendar list as the digest's calendar check (the
 * script holds calendar.readonly).
 *
 * Its own route, so a slow script never holds up the card's tasks.
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
  const dates = nextDates(today);
  const cal = DIGEST_SETTINGS["calendar-events"].config;
  const r = await callAppsScript<{ ok?: boolean; error?: string; events?: CalEvent[] }>(
    {
      action: "digestCalendar",
      days: 7,
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
      end: e.end ?? "",
      where: e.location ?? "",
      calendar: e.calendarName ?? "",
    }))
    .filter((e) => dates.includes(e.day))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  return NextResponse.json({ events });
}
