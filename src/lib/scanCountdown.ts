/**
 * The tagged-email scan's countdown (CheckForBills.tsx). Apps Script runs the
 * scan every 15 minutes; its timer drifts a few minutes, so "next" is an
 * estimate: the last run plus 15 minutes.
 */
export const SCAN_EVERY_MS = 15 * 60_000;

/** "every 15 min, next in ~9 min" from the last run's stamp and now. */
export function scanEvery(at: string | null | undefined, now: number): string {
  const last = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(last)) return "every 15 min";
  const left = Math.ceil((last + SCAN_EVERY_MS - now) / 60_000);
  return `every 15 min, next ${left > 0 ? `in ~${left} min` : "any minute"}`;
}
