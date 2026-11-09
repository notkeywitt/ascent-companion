/**
 * Paying the LSWDD statement — the rules the /lswdd page and the pay reminder
 * share. Pure, so both the server route and the browser can use it.
 *
 * LSWDD (the Lopez dump) bills one statement a month, due the 10th. Payment is
 * made at the dump, and the dump is open Friday to Monday only. So the real
 * deadline is the last open day on or before the due date, and the reminder
 * starts the day before that.
 */

/** 0 = Sunday … 6 = Saturday. LSWDD is open Friday, Saturday, Sunday, Monday. */
export const LSWDD_OPEN_DAYS: ReadonlySet<number> = new Set([5, 6, 0, 1]);

/** The day of the month a statement is due when its bills carry no due date. */
export const LSWDD_DUE_DAY = 10;

/** externalId the appscript gives each job's bill: "LSWDD-<statement date>-<project>". */
const EXTERNAL_ID_RE = /^LSWDD-(\d{4}-\d{2}-\d{2})-/;

/** The statement date ("YYYY-MM-DD") a bill came from, or "" when it is not an LSWDD statement bill. */
export function lswddStatementOf(externalId: string | null | undefined): string {
  return EXTERNAL_ID_RE.exec(String(externalId ?? "").trim())?.[1] ?? "";
}

const DAY_MS = 86_400_000;
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** `iso` moved by `days` calendar days. */
export function addDays(iso: string, days: number): string {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

/** The last day LSWDD is open on or before `dueIso` — the real deadline to pay. */
export function lswddLastPayDay(dueIso: string): string {
  let d = dueIso.slice(0, 10);
  for (let i = 0; i < 7 && !LSWDD_OPEN_DAYS.has(toDate(d).getUTCDay()); i++) d = addDays(d, -1);
  return d;
}

/** The day the pay reminder starts: the day before the last day to pay. */
export function lswddReminderStart(dueIso: string): string {
  return addDays(lswddLastPayDay(dueIso), -1);
}

/** The due date for a statement whose bills carry none: the 10th of the statement's month. */
export function lswddDefaultDue(statementDate: string): string {
  return `${statementDate.slice(0, 7)}-${String(LSWDD_DUE_DAY).padStart(2, "0")}`;
}

/** Where one bill stands, in the words the page shows. */
export type LswddPayState = "draft" | "approved" | "paid" | "void";

/**
 * JobTread status → pay state. `pending` is "approved for payment" on a Bill;
 * `approved` is paid (Record payment); `denied` is a void. A bill whose recorded
 * payments cover its cost reads as paid whatever its status.
 */
export function lswddPayState(b: { status: string; cost: number; amountPaid: number }): LswddPayState {
  if (b.status === "denied") return "void";
  if (b.status === "approved") return "paid";
  if (b.cost > 0 && b.amountPaid >= b.cost - 0.005) return "paid";
  if (b.status === "pending") return "approved";
  return "draft";
}

/**
 * The status /api/bill-status sets to approve a draft for payment. Same rule as
 * the Tracking Sheets approve: a Bill goes to `pending`, an Expense (already
 * paid) to `approved`.
 */
export function lswddApprovalTarget(b: { name: string; qboDocumentType: string }): "pending" | "approved" {
  return b.name === "Expense" || b.qboDocumentType === "purchase" ? "approved" : "pending";
}

/** What the reminder says today, or null when no reminder is due. */
export function lswddPayReminder(args: {
  today: string;
  dueDate: string;
  unpaid: number;
}): { lastPayDay: string; overdue: boolean } | null {
  if (args.unpaid === 0 || !args.dueDate) return null;
  const lastPayDay = lswddLastPayDay(args.dueDate);
  if (args.today < addDays(lastPayDay, -1)) return null;
  return { lastPayDay, overdue: args.today > lastPayDay };
}

/** "Mon, Nov 9" for a "YYYY-MM-DD". */
export function lswddDayLabel(iso: string): string {
  return toDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
