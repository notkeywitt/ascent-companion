/**
 * Month close for the tracking sheets, driven by the ONE month picker (Home).
 *
 * Moving the home billing month to month N closes month N-1. Month close files
 * N-1 into each wired tracking sheet's records (the reserved month block), then
 * moves the sheets on to N. The app asks until it has run: on every move
 * forward, and with a chip on Home while the month before it is still open.
 *
 * The month a record is written for never comes from what the picker held a
 * moment ago. It is always "the month before the one Home is going to", the
 * sheet is refreshed with THAT month's bills from JobTread before the copy,
 * and a sheet whose records already hold the month is left alone. So switching
 * back and forth cannot file one month's figures under another month's label.
 *
 * These are the rules; the dialog that runs them is
 * `src/components/MonthChangeSheets.tsx`. Client-safe and pure. Pinned by
 * `monthChangeSheets.test.ts`.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The stamp month close leaves in `month_action_runs` (action, scope). */
export const MONTH_CLOSE_ACTION = "month-close";
export const MONTH_CLOSE_SCOPE = "sheets";

/** True when `to` is a later billing month than `from`. Both are "YYYY-MM". */
export function isLaterMonth(from: string, to: string): boolean {
  return YM.test(from) && YM.test(to) && to > from;
}

/** "2026-11" → "2026-10"; "2026-01" → "2025-12". "" when not a month. */
export function prevMonth(ym: string): string {
  if (!YM.test(ym)) return "";
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The label a sheet's records block carries for billing month `ym`. A block is
 * named for the month its invoice goes out, the month after the billing month:
 * "2026-10" files as "November '26". Mirrors `_tsInvoicePeriodOf` in
 * ascent-appscript `TrackingSheets.js`.
 */
export function recordsLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!MONTH_NAMES[m - 1]) return ym;
  const month = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y + 1 : y;
  return `${MONTH_NAMES[month - 1]} '${String(year).slice(-2)}`;
}

/**
 * The month that month close must still file while Home is on (or going to)
 * `homeYm`, or "" when there is nothing to ask.
 *
 * It is the month before `homeYm`, and it is due when:
 *   - month close has not been stamped for it, and
 *   - the sheets have not moved past it (`sheetsYm`, the month the automatic
 *     sync writes, is not later). After a close the sheets sit on `homeYm`, so
 *     looking back at an older month never asks again.
 *
 * `sheetsYm` unknown ("") means the state could not be read: nothing is due,
 * because a close must not run on a guess.
 */
export function closeDue(homeYm: string, sheetsYm: string, closed: boolean): string {
  const closing = prevMonth(homeYm);
  if (!closing || closed || !YM.test(sheetsYm)) return "";
  return sheetsYm <= closing ? closing : "";
}

/** What a finalize dry run reports about the block the copy would land in. */
export interface FinalizeDryRun {
  mode?: string;
  overwroteValues?: boolean;
}

/**
 * "keep" when the sheet's records already hold figures for the month: the copy
 * would replace records, so the block is left as it is. "copy" otherwise (a
 * free block, or a labelled block that is still empty).
 */
export function planCopy(dry: FinalizeDryRun): "keep" | "copy" {
  return dry.mode === "overwrote-existing-month-block" && dry.overwroteValues === true ? "keep" : "copy";
}
