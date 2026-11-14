/**
 * The tracking-sheet month close — the rules. Client-safe and pure; pinned by
 * `monthClose.test.ts`.
 *
 * A wired job's month closes when its tracking sheet's CURRENT INVOICE is
 * copied into the next free record block (Apps Script op `finalize`). The
 * preview (`/api/month-close`) decides, per sheet, whether the close copies,
 * leaves a block that already holds the month, or skips a broken sheet. These
 * functions make that decision; the route only gathers the facts.
 *
 * Two month labels, one month apart:
 *   - the Labor tab's A1 names the BILLING month's labor file: "October '26 Labor";
 *   - a record block is named for the INVOICING month: October files as
 *     "November '26" (`_tsInvoicePeriodOf` in ascent-appscript TrackingSheets.js).
 */
import type { Grid } from "@/lib/invoiceReview/sheetCompare";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const CODE_RE = /^\d{2} \d{2} \d{2}$/;

export function isYm(v: unknown): v is string {
  return typeof v === "string" && YM.test(v);
}

/** "2026-10" → "2026-11". */
export function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** "2026-10" → "2026-09". */
export function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-10" → "October '26", the way the sheets write a month. */
export function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} '${String(y).slice(-2)}` : ym;
}

/** The label the record block for billing month `ym` carries: "2026-10" → "November '26". */
export function recordsLabel(ym: string): string {
  return isYm(ym) ? shortMonth(nextMonth(ym)) : ym;
}

/** The label the Labor tab's A1 must show for billing month `ym`: "October '26 Labor". */
export function laborLabel(ym: string): string {
  return `${shortMonth(ym)} Labor`;
}

// ---------------------------------------------------------------- labor month

export interface LaborMonthCheck {
  ok: boolean;
  /** What A1 shows now. */
  label: string;
  problems: string[];
}

const norm = (s: string) => s.replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

/** "10/1/2026" → "2026-10"; anything else → null. */
function ymOfDate(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}`;
}

/**
 * Does the sheet's Labor tab hold billing month `ym`? `labor` is the tab's
 * display values from A1 (`readTrackingSheet`). The tab pulls one month's labor
 * file by IMPORTRANGE, and a person points its A1 at that file by hand, so a
 * sheet can hold this month's bills beside another month's labor. Two checks:
 * A1 names the month's file, and every row's first and last work date falls
 * inside the month.
 */
export function checkLaborMonth(labor: Grid | null | undefined, ym: string): LaborMonthCheck {
  if (!labor || labor.length === 0) {
    return { ok: false, label: "", problems: ["The sheet has no Labor tab."] };
  }
  const label = String(labor[0]?.[0] ?? "").trim();
  const want = laborLabel(ym);
  const problems: string[] = [];
  if (!label) problems.push(`Labor tab A1 is empty. Point it at "${want}".`);
  else if (norm(label) !== norm(want)) problems.push(`Labor tab A1 points at "${label}", not "${want}".`);

  const month = shortMonth(ym).replace(/ '\d\d$/, "");
  const outside: string[] = [];
  for (let r = 1; r < labor.length; r++) {
    const code = String(labor[r]?.[0] ?? "").trim();
    if (!CODE_RE.test(code)) continue;
    for (const c of [2, 3]) {
      const d = labor[r]?.[c];
      const dym = ymOfDate(d);
      if (dym && dym !== ym) {
        outside.push(`row ${r + 1} (${code}) ${String(d).trim()}`);
        break;
      }
    }
  }
  if (outside.length) {
    const shown = outside.slice(0, 3).join("; ");
    problems.push(
      `Labor tab has work outside ${month}: ${shown}${outside.length > 3 ? ` and ${outside.length - 3} more` : ""}.`,
    );
  }
  return { ok: problems.length === 0, label, problems };
}

// ---------------------------------------------------------------- one sheet

/** What a finalize dry run reports about the block the copy would land in. */
export interface FinalizeDryRun {
  mode?: string;
  overwroteValues?: boolean;
  monthLabel?: string;
  targetRange?: string;
  labelCell?: string;
  blocksRemaining?: number;
}

/**
 * "keep" when the sheet already has a block for the month that holds figures:
 * a copy would replace a record, so the block is left as it is. "copy"
 * otherwise (a free block, or a labelled block that is still empty).
 */
export function planCopy(dry: FinalizeDryRun): "keep" | "copy" {
  return dry.mode === "overwrote-existing-month-block" && dry.overwroteValues === true ? "keep" : "copy";
}

export type SheetAction =
  /** Refresh the bills from JobTread, then copy CURRENT INVOICE into a block. */
  | "copy"
  /** The month's block already holds figures: leave it. The job counts as closed. */
  | "filed"
  /** Something is wrong with this sheet: name it, close the others. */
  | "skip";

export interface SheetPlanInput {
  /** The sheet is wired to more than one job. */
  shared: boolean;
  /** `readTrackingSheet` failed. */
  readError?: string;
  /** The finalize dry run failed (no free block, renamed tab, …). */
  finalizeError?: string;
  dry?: FinalizeDryRun;
  labor: LaborMonthCheck;
}

export interface SheetPlan {
  action: SheetAction;
  /** Why it skips, or what to know. Empty for a clean copy. */
  reasons: string[];
}

export function planSheet(i: SheetPlanInput): SheetPlan {
  if (i.shared) {
    return { action: "skip", reasons: ["This sheet is wired to more than one job. Wire it to one job."] };
  }
  const broken = [i.readError, i.finalizeError].filter((e): e is string => !!e);
  if (broken.length) return { action: "skip", reasons: broken };
  if (!i.dry) return { action: "skip", reasons: ["The sheet's record blocks could not be read."] };
  if (planCopy(i.dry) === "keep") {
    return {
      action: "filed",
      reasons: [`"${i.dry.monthLabel ?? ""}" already holds figures. It stays as it is.`],
    };
  }
  if (!i.labor.ok) return { action: "skip", reasons: i.labor.problems };
  const reasons: string[] = [];
  if (i.dry.mode === "overwrote-existing-month-block") {
    reasons.push(`"${i.dry.monthLabel ?? ""}" is labelled but empty. The copy fills it.`);
  }
  if (typeof i.dry.blocksRemaining === "number" && i.dry.blocksRemaining <= 1) {
    reasons.push(
      i.dry.blocksRemaining <= 0
        ? "This is the sheet's last free record block."
        : "One free record block is left after this one.",
    );
  }
  return { action: "copy", reasons };
}

// ---------------------------------------------------------------- the month

/**
 * How far the month's close has got: a job is closed once its block is filed
 * (stamped `finalize`, or found already holding the month).
 */
export function closeProgress(jobIds: string[], closed: Set<string>): { closed: number; total: number; done: boolean } {
  const n = jobIds.filter((id) => closed.has(id)).length;
  return { closed: n, total: jobIds.length, done: jobIds.length > 0 && n === jobIds.length };
}

/**
 * A hub action that writes a tracking sheet runs only for the sheets' month.
 * Any other month is either closed (its block is the record) or not open yet.
 * Returns why it is unavailable, or "" when it may run.
 */
export function sheetWriteBlocked(hubYm: string, sheetsYm: string): string {
  if (!isYm(hubYm) || !isYm(sheetsYm) || hubYm === sheetsYm) return "";
  return hubYm < sheetsYm
    ? `${shortMonth(hubYm)} is closed on the tracking sheets. Its record block stays as filed.`
    : `The tracking sheets are on ${shortMonth(sheetsYm)}. ${shortMonth(hubYm)} opens when ${shortMonth(sheetsYm)} closes.`;
}

/**
 * The month the sheets should be on when the stored month has fallen behind:
 * the month before Home's billing month. Null when the stored month is not
 * behind it. One-time catch-up; after it, only the close moves the month.
 */
export function sheetsCatchUp(sheetsYm: string, homeYm: string): string | null {
  if (!isYm(sheetsYm) || !isYm(homeYm)) return null;
  const want = prevMonth(homeYm);
  return sheetsYm < want ? want : null;
}
