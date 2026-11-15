/**
 * The review periods on the Labor page (/labor): a week (Monday to Sunday), a
 * half month (1st–15th, 16th–end) and a month. Dates are org-local
 * "YYYY-MM-DD" strings; the maths runs in UTC so no zone shifts a day.
 */

export type PeriodKind = "week" | "half" | "month";

export const PERIOD_KINDS: readonly PeriodKind[] = ["week", "half", "month"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDay = (s: string | null | undefined): s is string =>
  !!s && ISO_DAY.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}

const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The period of `kind` that contains `anchor`. */
export function periodOf(kind: PeriodKind, anchor: string): { from: string; to: string } {
  const [y, m, d] = anchor.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  if (kind === "week") {
    const dow = (toDate(anchor).getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 6) };
  }
  const last = `${y}-${mm}-${String(lastOfMonth(y, m)).padStart(2, "0")}`;
  if (kind === "half") {
    return d <= 15 ? { from: `${y}-${mm}-01`, to: `${y}-${mm}-15` } : { from: `${y}-${mm}-16`, to: last };
  }
  return { from: `${y}-${mm}-01`, to: last };
}

/** An anchor in the next (dir 1) or previous (dir -1) period. */
export function stepAnchor(kind: PeriodKind, anchor: string, dir: 1 | -1): string {
  const p = periodOf(kind, anchor);
  return dir > 0 ? addDays(p.to, 1) : addDays(p.from, -1);
}

/** Every [year, month] that the days from..to touch, in order. */
export function monthsTouched(from: string, to: string): [number, number][] {
  const out: [number, number][] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push([y, m]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "Nov 9 – Nov 15, 2026", "Nov 1 – 15, 2026", "November 2026". */
export function periodLabel(kind: PeriodKind, from: string, to: string): string {
  const f = toDate(from);
  const t = toDate(to);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  if (kind === "month") return fmt(f, { month: "long", year: "numeric" });
  const sameMonth = f.getUTCMonth() === t.getUTCMonth();
  const end = sameMonth ? String(t.getUTCDate()) : fmt(t, { month: "short", day: "numeric" });
  return `${fmt(f, { month: "short", day: "numeric" })} – ${end}, ${t.getUTCFullYear()}`;
}
