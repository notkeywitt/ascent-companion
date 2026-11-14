/**
 * Changing the home billing month to a later month closes the month it leaves.
 * Before the month moves, each wired tracking sheet's CURRENT INVOICE is copied
 * into its records (the reserved month block). These are the rules; the dialog
 * that runs them is `src/components/MonthChangeSheets.tsx`.
 *
 * Client-safe and pure. Pinned by `monthChangeSheets.test.ts`.
 */

const SHORT_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** True when `to` is a later billing month than `from`. Both are "YYYY-MM". */
export function isLaterMonth(from: string, to: string): boolean {
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/;
  return ym.test(from) && ym.test(to) && to > from;
}

/**
 * The label a sheet's records block carries for billing month `ym`. A block is
 * named for the month its invoice goes out, the month after the billing month:
 * "2026-10" files as "November '26". Mirrors `_tsInvoicePeriodOf` in
 * ascent-appscript `TrackingSheets.js`.
 */
export function recordsLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!SHORT_MONTHS[m - 1]) return ym;
  const month = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y + 1 : y;
  return `${SHORT_MONTHS[month - 1]} '${String(year).slice(-2)}`;
}

/** The automatic sync's state, as GET /api/tracking-sheet reports it. */
export interface SheetSyncState {
  paused?: boolean;
  triggerInstalled?: boolean;
}

/** True when the 30-minute sync rewrites the sheets: installed and not paused. */
export function syncIsRunning(sync: SheetSyncState | null | undefined): boolean {
  return sync?.triggerInstalled === true && sync.paused !== true;
}

/**
 * True when CURRENT INVOICE cannot be the month being closed: the sync is
 * running and holds every sheet on another month. A copy would then file the
 * wrong month's figures under the closing month's label, so none is made.
 * A paused sync writes nothing, so the sheets hold what the office left there.
 */
export function sheetsHoldAnotherMonth(
  sync: SheetSyncState | null | undefined,
  heldYm: string,
  closingYm: string,
): boolean {
  return syncIsRunning(sync) && !!heldYm && heldYm !== closingYm;
}

/** What a finalize dry run reports about the block the copy would land in. */
export interface FinalizeDryRun {
  mode?: string;
  overwroteValues?: boolean;
}

/**
 * "keep" when the sheet already has a block for the month that holds figures:
 * the copy would replace records, so the block is left as it is. "copy"
 * otherwise (a free block, or a labelled block that is still empty).
 */
export function planCopy(dry: FinalizeDryRun): "keep" | "copy" {
  return dry.mode === "overwrote-existing-month-block" && dry.overwroteValues === true ? "keep" : "copy";
}
