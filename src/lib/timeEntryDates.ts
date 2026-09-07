/**
 * THE DATE ARITHMETIC BEHIND THE SHARED TIME FILTER.
 *
 * Split out of `src/components/TimeEntryList.tsx` for one reason: it is pure,
 * and every failure in it is SILENT. A week that starts on the wrong day, or a
 * day read one off, just shows somebody the wrong hours — no error, and the
 * list looks perfectly plausible. It's also what a "which week was that?"
 * question gets answered from at payroll time. So it lives where the unit
 * suite can reach it (the vitest config takes pure `.ts` only).
 *
 * UTC THROUGHOUT, on purpose. The day strings arrive already converted to the
 * ORG's day (orgDay did that), so re-reading them in the viewer's zone would
 * shift every one of them back a day for anyone west of the org.
 */

/** Stands in for the empty cost code in the Cost code filter's <select>. */
export const UNCODED = "__uncoded__";
/** …and for a range the from/to boxes define, rather than a listed week. */
export const CUSTOM_RANGE = "__range__";
/** Prefix marking a whole-week option in the Date select: `W:<from>:<to>`. */
export const WEEK = "W:";

/**
 * "2026-08-11" → "Tue Aug 11". Parsed as UTC and formatted as UTC: the string
 * is already an ORG-local day (orgDay did that conversion), so re-reading it in
 * the viewer's zone would shift it back a day west of the org.
 */
export function dayLabel(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The same day without its weekday — "Aug 11" — for the two ends of a range. */
export function shortDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/** `day` shifted by n days, as another "YYYY-MM-DD". UTC throughout — see dayLabel. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The MONDAY of the week `day` falls in. Weeks run Monday–Sunday because that
 * is how a crew's week is counted here; a range that splits a week in half is
 * exactly the thing these presets exist to avoid.
 */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  // getUTCDay: 0 = Sunday, so Sunday steps back 6 rather than 0.
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** Decode a Date-select value into the range it means, or null for a single day / all. */
export function rangeOfSelection(
  sel: string,
  from: string,
  to: string,
): { from: string; to: string } | null {
  if (sel === CUSTOM_RANGE) return { from, to };
  if (sel.startsWith(WEEK)) {
    const [, f, t] = sel.split(":");
    return { from: f, to: t };
  }
  return null;
}

/**
 * The Monday-first calendar weeks that cover `from`..`to`, inclusive — a
 * rectangular month grid, so the calendar view can render 7 cells a row without
 * counting anything itself.
 *
 * Both ends are pulled out to their own week's edges: a month starting on a
 * Thursday still gets Mon–Wed drawn (empty), which is what makes the columns
 * line up as weekdays. Returns [] when either end is unparseable, so a list with
 * no dated entries draws nothing rather than a grid of "Invalid Date".
 */
export function calendarWeeks(from: string, to: string): string[][] {
  if (!Number.isFinite(Date.parse(`${from}T00:00:00Z`))) return [];
  if (!Number.isFinite(Date.parse(`${to}T00:00:00Z`))) return [];
  if (from > to) return [];
  const weeks: string[][] = [];
  // A crew's month is five or six weeks; the cap is a guard against a bad range
  // spinning here, not a real limit.
  for (let cur = weekStart(from), i = 0; cur <= to && i < 120; cur = addDays(cur, 7), i++) {
    weeks.push(Array.from({ length: 7 }, (_, d) => addDays(cur, d)));
  }
  return weeks;
}
