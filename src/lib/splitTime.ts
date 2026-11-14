import { clockOfMinutes, minutesOfClock } from "@/lib/orgTime";

/**
 * Split ONE time entry into two back-to-back halves whose minutes always sum to
 * the original. `firstMin` is the first half; the second half is whatever is
 * left, so the sum holds by construction. Null when either half would be empty.
 */
export function splitMinutes(
  totalMin: number,
  firstMin: number,
): { first: number; second: number } | null {
  if (!Number.isInteger(totalMin) || !Number.isInteger(firstMin)) return null;
  if (firstMin <= 0 || firstMin >= totalMin) return null;
  return { first: firstMin, second: totalMin - firstMin };
}

/**
 * The two halves as org-local wall clocks. The first keeps the entry's day and
 * start; the second starts where the first ends (`dayOffset` 1 when that is
 * past midnight) and ends where the entry ended.
 */
export function splitClocks(start: string, end: string, firstMin: number) {
  const s = minutesOfClock(start);
  const e = minutesOfClock(end);
  if (s == null || e == null) return null;
  const total = (e - s + 1440) % 1440 || 1440;
  const parts = splitMinutes(total, firstMin);
  if (!parts) return null;
  const mid = s + parts.first;
  return {
    ...parts,
    total,
    a: { start, end: clockOfMinutes(mid) },
    b: { start: clockOfMinutes(mid), end, dayOffset: Math.floor(mid / 1440) },
  };
}
