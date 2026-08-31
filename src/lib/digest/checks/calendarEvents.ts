/**
 * Check "calendar-events" (Calendar) — what's on the shared calendars today and
 * for the next few days.
 *
 * READ-ONLY, AND STRUCTURALLY SO. The Apps Script side holds
 * `calendar.readonly` — not the read/write scope — so this feature is incapable
 * of creating, moving or deleting an event on anyone's calendar even if a
 * future edit tried. That is deliberate: a digest that could touch the office
 * calendar is a different, much riskier feature.
 *
 * WHOSE CALENDARS. Only the shared, operational ones named in settings.ts. The
 * account's own primary calendar is excluded unless somebody deliberately turns
 * `includePrimary` on — the digest is an office report, and a personal calendar
 * is not office data. When nothing in the settings matches, the check does NOT
 * guess: it reports what calendars it can see so the ids can be pasted into
 * settings, which is a configuration problem, not a data problem.
 */
import { callAppsScript } from "@/lib/appsScript";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { CalendarEventsConfig } from "../settings";

interface CalEvent {
  id?: string;
  calendarName?: string;
  title?: string;
  location?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  day?: string;
  startLabel?: string;
  endLabel?: string;
}
interface CalendarResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  calendars?: { id: string; name: string }[];
  events?: CalEvent[];
  available?: { id: string; name: string; isPrimary: boolean }[];
}

/** "2026-08-31" → "Today" / "Tomorrow" / "Mon, Sep 2". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const t = Date.parse(`${today}T00:00:00Z`);
  const d = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isNaN(t) && !Number.isNaN(d) && d - t === 86_400_000) return "Tomorrow";
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The item title for one event — prefixes WHO it belongs to when `showWho`. */
export function eventTitle(
  e: { startLabel?: string; title?: string; calendarName?: string },
  showWho: boolean,
): string {
  const who = showWho && e.calendarName ? `${e.calendarName} — ` : "";
  return `${e.startLabel ?? ""} · ${who}${e.title ?? "(no title)"}`.trim();
}

/** "When" for one event — the full time range, not just the start. */
export function eventWhen(e: { allDay?: boolean; startLabel?: string; endLabel?: string }): string {
  if (e.allDay) return "All day";
  if (e.endLabel && e.endLabel !== e.startLabel) return `${e.startLabel ?? ""}–${e.endLabel}`;
  return e.startLabel ?? "";
}

export const calendarEventsCheck = defineCheck<CalendarEventsConfig>({
  id: "calendar-events",
  title: "On the Calendar",
  category: "calendar",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as CalendarEventsConfig,

  async run({ config, settings, today, log }): Promise<CheckResult> {
    const r = await callAppsScript<CalendarResponse>(
      {
        action: "digestCalendar",
        days: config.days,
        calendarIds: config.calendarIds,
        calendarNames: config.calendarNames,
        includePrimary: config.includePrimary,
      },
      { timeoutMs: settings.appsScriptTimeoutMs },
    );
    if (r.error) return checkError(`Couldn't read the calendars: ${r.error}`);
    if (r.data?.ok === false) return checkError(r.data.error || "Calendar read failed.");

    const chosen = r.data?.calendars ?? [];
    if (chosen.length === 0) {
      // Not an error — a setup step. Say exactly what to do, and with what.
      const available = (r.data?.available ?? []).filter((c) => !c.isPrimary);
      log(`no shared calendar matched ${JSON.stringify(config.calendarNames)}; ${available.length} available`);
      return {
        status: "warning",
        summary: "No shared calendar is configured yet.",
        items: available.slice(0, 20).map((c) => ({
          title: c.name,
          detail:
            "Add this calendar's id to `calendarIds` (or a fragment of its name to " +
            `\`calendarNames\`) in src/lib/digest/settings.ts to include it. Id: ${c.id}`,
          group: "Available calendars",
        })),
      };
    }

    const events = r.data?.events ?? [];
    log(`${events.length} event(s) over ${config.days} day(s) from: ${chosen.map((c) => c.name).join(", ")}`);
    if (events.length === 0) {
      return allClear(`Nothing scheduled in the next ${config.days} day${config.days === 1 ? "" : "s"}.`);
    }

    // Show WHOSE calendar an item is on directly in the title — but only when
    // more than one calendar actually turned up an event today. With a single
    // calendar configured (or the others simply quiet today), naming it on
    // every line would repeat what the reader already knows.
    const distinctCalendars = new Set(events.map((e) => e.calendarName).filter(Boolean));
    const showWho = distinctCalendars.size > 1;

    const items: DigestItem[] = events.map((e) => ({
      title: eventTitle(e, showWho),
      detail:
        [
          `When: ${eventWhen(e)}`,
          e.location ? `Where: ${e.location}` : "",
          e.calendarName ? `Calendar: ${e.calendarName}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      date: e.day,
      group: dayLabel(e.day ?? "", today),
    }));

    const todayCount = events.filter((e) => e.day === today).length;
    return {
      // Informational, never a warning: a full calendar is not a problem.
      status: "ok",
      items,
      summary:
        todayCount > 0
          ? `${todayCount} event${todayCount === 1 ? "" : "s"} today, ${events.length} over the next ${config.days} days.`
          : `Nothing today; ${events.length} event${events.length === 1 ? "" : "s"} over the next ${config.days} days.`,
    };
  },
});
