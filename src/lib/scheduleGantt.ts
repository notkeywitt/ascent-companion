/**
 * The Schedule page's Gantt math (src/app/schedule). Pure and client-safe.
 *
 * A window is a run of whole days. A task is a bar from its start day to its
 * end day, both included. Jobs group the tasks; a task keeps JobTread's phase
 * and order, so the page reads like JobTread's own Gantt.
 */

const DAY_MS = 86_400_000;

export const WINDOWS = [
  { key: "4w", label: "4 weeks", days: 28 },
  { key: "12w", label: "12 weeks", days: 84 },
] as const;
export type WindowKey = (typeof WINDOWS)[number]["key"];

/** The most days one request may span (the route refuses more). */
export const MAX_WINDOW_DAYS = 120;

const parse = (day: string) => Date.parse(day + "T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDay = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(parse(s));

export const addDays = (day: string, n: number) => iso(parse(day) + n * DAY_MS);

/** Whole days from `a` to `b` (negative when b is earlier). */
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY_MS);

/** The Monday on or before `day`. */
export function mondayOf(day: string): string {
  const dow = (new Date(parse(day)).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export const isWeekend = (day: string) => {
  const w = new Date(parse(day)).getUTCDay();
  return w === 0 || w === 6;
};

/** The days a window shows: `count` days from `start`. */
export function windowDays(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export interface GanttTaskIn {
  id: string;
  name: string;
  phase: string;
  phasePosition?: string;
  position?: string;
  startDate: string;
  endDate: string;
  progress: number | null;
  jobId: string;
  jobName: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  taskTypeName?: string | null;
}

export interface GanttBar {
  task: GanttTaskIn;
  /** Percent of the window, 0..100. A bar that runs past either end is clipped. */
  left: number;
  width: number;
  /** True when the task starts before / ends after the window. */
  clipStart: boolean;
  clipEnd: boolean;
}

export interface GanttJob {
  id: string;
  name: string;
  /** "Customer - Job" when the customer is known. */
  label: string;
  bars: GanttBar[];
}

const byKey = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");

/**
 * Jobs with at least one task in the window, each with its bars. Jobs sort by
 * their earliest start, then name. Tasks sort by phase order, then their own
 * order, then start date, as JobTread lists them.
 */
export function buildGantt(
  tasks: GanttTaskIn[],
  customers: Map<string, string>,
  from: string,
  count: number,
): GanttJob[] {
  const to = addDays(from, count - 1);
  const jobs = new Map<string, GanttJob>();
  for (const t of tasks) {
    if (!t.jobId || t.endDate < from || t.startDate > to) continue;
    const s = t.startDate < from ? from : t.startDate;
    const e = t.endDate > to ? to : t.endDate;
    const left = (daysBetween(from, s) / count) * 100;
    const width = ((daysBetween(s, e) + 1) / count) * 100;
    let job = jobs.get(t.jobId);
    if (!job) {
      const customer = customers.get(t.jobId);
      job = {
        id: t.jobId,
        name: t.jobName,
        label: customer ? `${customer} - ${t.jobName}` : t.jobName,
        bars: [],
      };
      jobs.set(t.jobId, job);
    }
    job.bars.push({ task: t, left, width, clipStart: t.startDate < from, clipEnd: t.endDate > to });
  }
  for (const j of jobs.values()) {
    j.bars.sort(
      (a, b) =>
        byKey(a.task.phasePosition, b.task.phasePosition) ||
        byKey(a.task.position, b.task.position) ||
        a.task.startDate.localeCompare(b.task.startDate),
    );
  }
  const first = (j: GanttJob) => j.bars.reduce((m, b) => (b.task.startDate < m ? b.task.startDate : m), "9999-12-31");
  return [...jobs.values()].sort((a, b) => first(a).localeCompare(first(b)) || a.label.localeCompare(b.label));
}

/** Month headings over the window: each month's first column and how many columns it spans. */
export function monthSpans(days: string[]): { label: string; start: number; span: number }[] {
  const out: { label: string; start: number; span: number }[] = [];
  days.forEach((d, i) => {
    const key = d.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.label === key) last.span += 1;
    else out.push({ label: key, start: i, span: 1 });
  });
  return out.map((m) => ({
    ...m,
    label: new Date(parse(m.label + "-01")).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" }),
  }));
}
