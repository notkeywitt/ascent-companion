/**
 * Org-timezone wall clocks, for the BROWSER.
 *
 * lib/jobtread.ts already owns this conversion (jtIsoToOrgLocal /
 * orgLocalToJtIso) and stays the authority — but that module is the server's
 * JobTread client, so importing it from a client component would drag the whole
 * Pave layer and its config into the bundle. This is the read half only, small
 * and dependency-free, for surfaces that have to SHOW a JobTread timestamp as
 * the wall clock JobTread itself shows. The write half stays server-side: a
 * client sends the wall clock it collected, and the route converts it.
 *
 * Why it matters: a JobTread timestamp is a true UTC instant, and the org reads
 * it in Pacific. Slicing the ISO string instead — a 7-hour error in summer —
 * showed a 9:00 AM entry as 4:00 PM.
 */
export const ORG_TZ = "America/Los_Angeles";

/** A JobTread instant → { date: "YYYY-MM-DD", time: "HH:MM" } in the org's zone. */
export function orgParts(iso: string | null | undefined): { date: string; time: string } {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return { date: "", time: "" };
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORG_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(t));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

/** Just the org-local day of a JobTread instant, "" when unparseable. */
export const orgDay = (iso: string | null | undefined) => orgParts(iso).date;

/** "HH:MM" → minutes past midnight, or null. */
export function minutesOfClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** minutes past midnight → "HH:MM", wrapping past midnight (an overnight shift). */
export function clockOfMinutes(total: number): string {
  const m = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Hours between two wall clocks on consecutive days at most — an end EARLIER
 * than the start reads as the next morning, which is what an overnight shift is.
 */
export function spanHours(start: string, end: string): number | null {
  const s = minutesOfClock(start);
  const e = minutesOfClock(end);
  if (s == null || e == null) return null;
  return ((e - s + 1440) % 1440) / 60;
}

/** "12:30 PM", for display next to an editable 24-hour field. */
export function prettyClock(hhmm: string): string {
  const m = minutesOfClock(hhmm);
  if (m == null) return "";
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
