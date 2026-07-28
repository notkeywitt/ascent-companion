/**
 * Shared formatting/parsing for leave (PTO / sick) amounts.
 *
 * Leave is stored as decimal hours to 2 decimal places. Every whole-minute
 * amount round-trips losslessly through that storage as long as it is displayed
 * to the nearest minute — so these helpers are the single source of truth for
 * turning stored decimal hours into an "hours + minutes" display, and turning
 * an hours + minutes entry back into the decimal hours the API stores.
 */

/**
 * Format decimal hours as hours + minutes, e.g. 8.5 → "8h 30m", -8 → "−8h",
 * 0.25 → "15m". Rounds to the nearest minute. Zero renders "0h".
 */
export function fmtHM(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const sign = n < 0 ? "−" : "";
  const totalMin = Math.round(Math.abs(n) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || !h) parts.push(`${m}m`);
  return sign + parts.join(" ");
}

/** Combine hours + minutes fields into decimal hours (2-dp), preserving whole minutes. */
export function hmToDecimal(hStr: string, mStr: string): number {
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  return Math.round((h + m / 60) * 100) / 100;
}
