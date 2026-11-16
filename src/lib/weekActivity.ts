/**
 * Home's This week card (WeekAhead.tsx): what is on each job each day, with
 * clock times where JobTread holds them. Client-safe: no Pave import.
 *
 * A day's count for a job is
 *   - every open schedule task on the job whose span covers that day, plus
 *   - every open to-do on the job that is DUE that day (its end date, or its
 *     start date when it has no end).
 * A schedule task is work in progress on each day it spans. A to-do is one
 * thing to finish, so it counts once, on the day it is due.
 *
 * The days are the caller's (`dates`): the card reads today and the next six
 * (`nextDates`); the default is Sunday to Saturday. All in the org's time zone
 * (the route passes the org's day).
 */
import type { ToDoPatch } from "@/lib/jobtread/tasks";

export interface WeekItem {
  id: string;
  name: string;
  kind: "task" | "todo";
  /** The phase a schedule task sits under; "" for a to-do or a task with none. */
  phase: string;
  /** A task's span, YYYY-MM-DD. A to-do's start and end are both its due day. */
  start: string;
  end: string;
  /** Clock times, "HH:MM" 24-hour; "" when the task has none (a to-do never does). */
  startTime: string;
  endTime: string;
  /** Its JobTread description. */
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
  startTime?: string;
  endTime?: string;
  jobId: string;
  jobName: string;
  description?: string;
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

/** "07:30:00" → "07:30"; anything else → "". */
const hhmm = (t?: string | null) => (t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : "");

const DAY_MS = 86_400_000;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Sunday..Saturday dates of the week holding `day` (YYYY-MM-DD). */
export function weekDates(day: string): string[] {
  const t = parse(day);
  const sunday = t - new Date(t).getUTCDay() * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => iso(sunday + i * DAY_MS));
}

/** Today and the six days after it (YYYY-MM-DD): Home's rolling week. */
export function nextDates(day: string): string[] {
  const t = parse(day);
  return Array.from({ length: 7 }, (_, i) => iso(t + i * DAY_MS));
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
  dates: string[] = weekDates(today),
  /** Every open job; one with nothing this week still gets a row. */
  openJobs: { id: string; name: string }[] = [],
): WeekActivity {
  const jobs = new Map<string, WeekJob>();
  const job = (id: string, name: string) => {
    let j = jobs.get(id);
    if (!j) {
      j = { id, name: customerJob(customers.get(id), name), days: dates.map(() => []), total: 0 };
      jobs.set(id, j);
    }
    return j;
  };
  for (const o of openJobs) job(o.id, o.name);
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
          // A multi-day task keeps its times on its first and last day only.
          startTime: d === t.startDate ? hhmm(t.startTime) : "",
          endTime: d === t.endDate ? hhmm(t.endTime) : "",
          description: t.description ?? "",
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
      startTime: "",
      endTime: "",
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

/** One edit from the week's form. A to-do's due day is `end`; `start` is ignored for it. */
export interface ItemPatch {
  name?: string;
  description?: string;
  start?: string;
  end?: string;
  done?: boolean;
}

/**
 * The week after an edit, without a reload (the reads are cached). Done
 * removes the item; new dates move it onto every week day its span covers
 * (a to-do: its due day), out of the week when none fall inside; a new name
 * or description updates it in place.
 */
export function patchItem(w: WeekActivity, kind: WeekItem["kind"], id: string, patch: ItemPatch): WeekActivity {
  const jobs = w.jobs.map((j) => {
    let was: WeekItem | undefined;
    const days = j.days.map((items) =>
      items.filter((i) => {
        if (i.kind !== kind || i.id !== id) return true;
        was = i;
        return false;
      }),
    );
    if (!was) return j;
    const end = patch.end ?? was.end;
    const start = kind === "todo" ? end : (patch.start ?? was.start);
    if (!patch.done) {
      const next: WeekItem = {
        ...was,
        name: patch.name ?? was.name,
        description: patch.description ?? was.description,
        start,
        end,
      };
      w.dates.forEach((d, i) => {
        if (start <= d && d <= end) days[i] = [...days[i], next];
      });
    }
    return { ...j, days, total: days.reduce((s, d) => s + d.length, 0) };
  });
  return { ...w, jobs };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The week edit route's body → the `updateToDo` patch, or the reason it is
 * refused. Only name, description, dates and done pass. A schedule task needs
 * both dates when either changes, start on or before end; it cannot lose them.
 * A to-do's `end` is its due date, and an empty one clears it.
 */
export function itemEditPatch(kind: WeekItem["kind"], body: Record<string, unknown>): ToDoPatch | string {
  const patch: ToDoPatch = {};
  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (!name) return "It needs a name.";
    patch.name = name;
  }
  if (body.description !== undefined)
    patch.description = body.description === null ? null : String(body.description);
  const start = body.start == null ? "" : String(body.start).trim();
  const end = body.end == null ? "" : String(body.end).trim();
  for (const d of [start, end]) if (d && !DAY.test(d)) return `Unreadable date: ${d}`;
  if (kind === "todo") {
    if (body.end !== undefined) patch.dueDate = end || null;
  } else if (body.start !== undefined || body.end !== undefined) {
    if (!start || !end) return "A schedule task needs a start and an end.";
    if (start > end) return "The start is after the end.";
    patch.startDate = start;
    patch.dueDate = end;
  }
  if (body.done !== undefined) patch.done = body.done === true;
  if (Object.keys(patch).length === 0) return "Nothing to change.";
  return patch;
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
