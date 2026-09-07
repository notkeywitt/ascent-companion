/**
 * The home board's job card — shape + the pure date math behind its schedule
 * line. Client-safe on purpose: the card renders in the browser, so nothing
 * here may import the Pave layer (same reason lib/orgTime.ts exists). The
 * JobTread reads that fill these live in getJobBoard() (lib/jobtread.ts).
 *
 * The schedule line answers "where is this job on the JobTread Gantt chart":
 * the whole-job span, how far through it today is, the tasks whose window
 * covers today, and the next one to start.
 */

/** One JobTread schedule task (`task` with isToDo=false) reduced to its bar. */
export interface ScheduleTask {
  name: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export interface JobSchedule {
  /** The job's whole Gantt span — min start / max end over its schedule. */
  start: string;
  end: string;
  /** Where today sits in that span, 0..1. */
  pctElapsed: number;
  /** Tasks whose window covers today, shortest window first (leaf before phase). */
  now: ScheduleTask[];
  /** The first task starting after today, or null at the end of the schedule. */
  next: ScheduleTask | null;
}

export interface JobBoardCard {
  id: string;
  name: string;
  customer: string;
  /** JobTread's own "Phase" custom field — how the office marks a job's state. */
  phase: string | null;
  /** JobTread's own Budgeted Cost, or the base estimate when no order exists. */
  budget: number;
  /** Whether that budget came from approved customer orders or budget leaves. */
  budgetBasis: "orders" | "leaves" | "none";
  bills: number; // approved + pending vendor bills
  labor: number; // time-entry cost
  schedule: JobSchedule | null; // null = nothing dated in JobTread
}

/**
 * The Phase value that means "we are building this". EVERY job in the org is
 * open (nothing carries a closedOn date), so `Phase` — not closure — is what
 * separates the jobs on site from the pre-construction budgets, the
 * prospects, the finished work and Ascent's own overhead jobs.
 */
export const ACTIVE_PHASE = "Active";

/** Spent = the same two actuals the /jobs browser adds up. */
export const spentOf = (c: { bills: number; labor: number }) => c.bills + c.labor;

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Days a task's bar covers, inclusive. */
const widthOf = (t: ScheduleTask) => (dayMs(t.end) - dayMs(t.start)) / 86_400_000 + 1;

/** Shortest bar first: the leaf task is what the crew is on, its phase is context. */
export const byWindow = (tasks: ScheduleTask[]) =>
  [...tasks].sort((a, b) => widthOf(a) - widthOf(b) || a.start.localeCompare(b.start));

/** How far through `start`…`end` today is, clamped to 0..1. */
export function spanPct(start: string, end: string, today: string): number {
  const a = dayMs(start);
  const b = dayMs(end);
  const t = dayMs(today);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t) || b <= a) {
    return t >= b ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

/**
 * "2026-09-14" → "Sep 14", and "2027-10-15" → "Oct 15, 2027". A job schedule
 * runs for years, so a bare "Oct 15" on a 2027 end date reads as next month.
 */
export function shortDate(d: string, thisYear = new Date().getFullYear()): string {
  const t = dayMs(d);
  if (!Number.isFinite(t)) return "";
  const date = new Date(t);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(date.getUTCFullYear() === thisYear ? {} : { year: "numeric" }),
  });
}

/** "Sep 2 – Sep 14", or one date when the bar is a single day. */
export const dateRange = (t: ScheduleTask) =>
  t.start === t.end ? shortDate(t.start) : `${shortDate(t.start)} – ${shortDate(t.end)}`;

/** The card's one-line answer to "what is happening on this job right now". */
export function scheduleHeadline(s: JobSchedule | null): string {
  if (!s) return "No schedule in JobTread";
  if (s.now.length > 0) return s.now[0].name;
  if (s.next) return `Next: ${s.next.name}`;
  return "Schedule complete";
}

/** The quiet facts under that headline — dates, containing phase, elapsed share. */
export function scheduleMeta(s: JobSchedule | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  const lead = s.now[0] ?? s.next;
  if (lead) out.push(dateRange(lead));
  // The widest bar covering today IS the Gantt phase the leaf sits under.
  const phase = s.now.length > 1 ? s.now[s.now.length - 1] : null;
  if (phase) out.push(phase.name);
  out.push(`${Math.round(s.pctElapsed * 100)}% of schedule`);
  out.push(`ends ${shortDate(s.end)}`);
  return out;
}
