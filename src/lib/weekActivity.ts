/**
 * Home's week bars (owner, 2026-11-15): how busy each job is on each day of
 * this week, and what the details panel lists for a pick. Client-safe: no
 * Pave import.
 *
 * A day's count for a job is
 *   - every open schedule task on the job whose span covers that day, plus
 *   - every open to-do on the job that is DUE that day (its end date, or its
 *     start date when it has no end).
 * A schedule task is work in progress on each day it spans. A to-do is one
 * thing to finish, so it counts once, on the day it is due.
 *
 * The week runs Sunday to Saturday, in the org's time zone (the route passes
 * the org's day).
 */

export interface WeekItem {
  id: string;
  name: string;
  kind: "task" | "todo";
  /** The phase a schedule task sits under; "" for a to-do or a task with none. */
  phase: string;
  /** A task's span, YYYY-MM-DD. A to-do's start and end are both its due day. */
  start: string;
  end: string;
  /** A to-do's description; "" for a task. */
  description: string;
}

export interface WeekJob {
  id: string;
  /** "Customer - Job" when the route knows the customer, else the job name. */
  name: string;
  /** Items per day, Sunday first. Seven entries. */
  days: WeekItem[][];
  /** Item-days across the week: the sum of the seven counts. */
  total: number;
}

export interface WeekActivity {
  /** The org's today, YYYY-MM-DD. */
  today: string;
  /** Sunday..Saturday, YYYY-MM-DD. */
  dates: string[];
  /** Busiest week first. */
  jobs: WeekJob[];
}

interface TaskIn {
  id: string;
  name: string;
  phase?: string;
  startDate: string;
  endDate: string;
  jobId: string;
  jobName: string;
}
interface ToDoIn {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  jobId?: string | null;
  jobName?: string | null;
  description?: string;
}

const DAY_MS = 86_400_000;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Sunday..Saturday dates of the week holding `day` (YYYY-MM-DD). */
export function weekDates(day: string): string[] {
  const t = parse(day);
  const sunday = t - new Date(t).getUTCDay() * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => iso(sunday + i * DAY_MS));
}

/** "Customer - Job"; the job name alone when the customer is unknown. */
export const customerJob = (customer: string | undefined, job: string) =>
  customer ? `${customer} - ${job}` : job;

/** `customers` maps a job id to its customer, for the "Customer - Job" label. */
export function buildWeekActivity(
  today: string,
  tasks: TaskIn[],
  todos: ToDoIn[],
  customers: Map<string, string> = new Map(),
): WeekActivity {
  const dates = weekDates(today);
  const jobs = new Map<string, WeekJob>();
  const job = (id: string, name: string) => {
    let j = jobs.get(id);
    if (!j) {
      j = { id, name: customerJob(customers.get(id), name), days: dates.map(() => []), total: 0 };
      jobs.set(id, j);
    }
    return j;
  };
  for (const t of tasks) {
    if (!t.jobId || !t.startDate || !t.endDate) continue;
    dates.forEach((d, i) => {
      if (t.startDate <= d && d <= t.endDate)
        job(t.jobId, t.jobName).days[i].push({
          id: t.id,
          name: t.name,
          kind: "task",
          phase: t.phase ?? "",
          start: t.startDate,
          end: t.endDate,
          description: "",
        });
    });
  }
  for (const t of todos) {
    const due = t.endDate || t.startDate || "";
    const i = due ? dates.indexOf(due) : -1;
    if (!t.jobId || i < 0) continue;
    job(t.jobId, t.jobName || "").days[i].push({
      id: t.id,
      name: t.name,
      kind: "todo",
      phase: "",
      start: due,
      end: due,
      description: t.description ?? "",
    });
  }
  for (const j of jobs.values()) j.total = j.days.reduce((s, d) => s + d.length, 0);
  return {
    today,
    dates,
    jobs: [...jobs.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

/** What the details panel lists: a job, a day, or the one job on one day. */
export interface WeekPick {
  job: string | null;
  day: number | null;
}

export interface PickedItem {
  job: WeekJob;
  item: WeekItem;
  /** The first day of the week the item shows on, inside the pick. */
  day: number;
}

/**
 * The items a pick covers, each with its job, once. A task that spans several
 * days of a picked job lists once, on its first day in the week.
 */
export function pickedItems(w: WeekActivity, pick: WeekPick): PickedItem[] {
  const out: PickedItem[] = [];
  const seen = new Set<string>();
  for (const job of w.jobs) {
    if (pick.job !== null && job.id !== pick.job) continue;
    job.days.forEach((items, day) => {
      if (pick.day !== null && day !== pick.day) return;
      for (const item of items) {
        const key = `${job.id}:${item.kind}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ job, item, day });
      }
    });
  }
  return out;
}

/**
 * The week after a to-do edit, without a reload (the to-do read is cached
 * 60 s). Done removes it; a new due day moves it, out of the week when the day
 * falls outside; a new name or description updates it in place.
 */
export function patchToDo(
  w: WeekActivity,
  id: string,
  patch: { name?: string; description?: string; due?: string; done?: boolean },
): WeekActivity {
  const jobs = w.jobs.map((j) => {
    let was: WeekItem | undefined;
    const days = j.days.map((items) =>
      items.filter((i) => {
        if (i.kind !== "todo" || i.id !== id) return true;
        was = i;
        return false;
      }),
    );
    if (!was) return j;
    const due = patch.due ?? was.end;
    const at = w.dates.indexOf(due);
    if (!patch.done && at >= 0) {
      days[at] = [
        ...days[at],
        {
          ...was,
          name: patch.name ?? was.name,
          description: patch.description ?? was.description,
          start: due,
          end: due,
        },
      ];
    }
    return { ...j, days, total: days.reduce((s, d) => s + d.length, 0) };
  });
  return { ...w, jobs };
}

/**
 * How strongly a day's bars draw, 0..1, at time `t` = days since Sunday 00:00
 * (Wednesday 3 PM is 3.625). Today is full strength. Days to come fade with
 * distance; days gone fade faster. Tomorrow sharpens as today goes on, and
 * yesterday dims, so the grid changes a little through the day.
 */
export function nearness(day: number, t: number): number {
  if (day === Math.floor(t)) return 1;
  const away = day + 0.5 - t;
  if (away >= 0) return Math.max(0.22, 1 - 0.24 * Math.max(0, away - 0.5));
  return Math.max(0.14, 0.55 - 0.2 * (-away - 0.5));
}
