// How the tool schedule page lays its data out — pure and client-safe. The
// rules that decide what is needed live in toolSchedule.ts; this only arranges
// the answer for the Gantt, the calendar and the list.

import { dayIso, dayNum, findShortfalls, type DemandSpan, type KindSchedule, type MoveNeeded } from "@/lib/toolSchedule";

/** A span placed on a lane, so overlapping spans in one Gantt row stack. */
export interface LanedSpan extends DemandSpan {
  lane: number;
}

/** First-fit lanes: each span takes the lowest lane free on its first day. */
export function assignLanes(spans: DemandSpan[]): { spans: LanedSpan[]; lanes: number } {
  const ends: number[] = [];
  const sorted = [...spans].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const out = sorted.map((s) => {
    const a = dayNum(s.startDate);
    let lane = ends.findIndex((end) => end < a);
    if (lane < 0) {
      lane = ends.length;
      ends.push(dayNum(s.endDate));
    } else ends[lane] = dayNum(s.endDate);
    return { ...s, lane };
  });
  return { spans: out, lanes: Math.max(1, ends.length) };
}

/** One tool type's need on one day. */
export interface DayNeed {
  kindId: string;
  name: string;
  need: number;
  owned: number;
  short: boolean;
  jobs: { id: string; name: string }[];
}

function needOn(row: KindSchedule, a: number, b: number): DayNeed | null {
  const hit = row.spans.filter((s) => dayNum(s.startDate) <= b && dayNum(s.endDate) >= a);
  if (hit.length === 0) return null;
  // The peak over the period, counting a job once a day (its largest quantity).
  let need = 0;
  for (let d = a; d <= b; d++) {
    const perJob = new Map<string, number>();
    for (const s of hit)
      if (dayNum(s.startDate) <= d && dayNum(s.endDate) >= d) perJob.set(s.jobId, Math.max(perJob.get(s.jobId) ?? 0, s.qty));
    let n = 0;
    for (const q of perJob.values()) n += q;
    need = Math.max(need, n);
  }
  const jobs = new Map<string, string>();
  for (const s of hit) jobs.set(s.jobId, s.jobName);
  return {
    kindId: row.kindId,
    name: row.name,
    need,
    owned: row.owned,
    short: need > row.owned,
    jobs: [...jobs].map(([id, name]) => ({ id, name })),
  };
}

const byShortThenName = (a: DayNeed, b: DayNeed) => Number(b.short) - Number(a.short) || a.name.localeCompare(b.name);

/** Every tool type needed on `day`, shortfalls first. */
export function needsOnDay(rows: KindSchedule[], day: string): DayNeed[] {
  const d = dayNum(day);
  return rows.map((r) => needOn(r, d, d)).filter((x): x is DayNeed => !!x).sort(byShortThenName);
}

/** Monday of the week `day` falls in. */
export function mondayOf(day: string): string {
  const n = dayNum(day);
  const dow = new Date(n * 86_400_000).getUTCDay(); // 0 = Sunday
  return dayIso(n - ((dow + 6) % 7));
}

/** The range as weeks (Monday first), each with the tool types it needs. Empty weeks are left out. */
export function weeksOfNeed(rows: KindSchedule[], from: string, to: string): { week: string; needs: DayNeed[] }[] {
  const out: { week: string; needs: DayNeed[] }[] = [];
  const f = dayNum(from);
  const t = dayNum(to);
  for (let w = dayNum(mondayOf(from)); w <= t; w += 7) {
    const a = Math.max(f, w);
    const b = Math.min(t, w + 6);
    const needs = rows.map((r) => needOn(r, a, b)).filter((x): x is DayNeed => !!x).sort(byShortThenName);
    if (needs.length) out.push({ week: dayIso(w), needs });
  }
  return out;
}

/** A stable colour slot (0–7) per job, in the order jobs first appear. */
export function jobColourIndex(jobIds: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of jobIds) if (!m.has(id)) m.set(id, m.size % 8);
  return m;
}

/**
 * The spans that sit in a shortfall: a named tool booked twice (or not
 * usable), or "any of a type" on a day the type runs short. Keyed by task id
 * or booking id, each with the targets that ran short — the Gantt marks those bars.
 */
export function conflictsBySource(rows: KindSchedule[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.shortfalls.length === 0) continue;
    for (const s of r.spans) {
      const hit = r.shortfalls.some(
        (sf) =>
          s.startDate <= sf.endDate &&
          s.endDate >= sf.startDate &&
          sf.jobIds.includes(s.jobId) &&
          (s.toolId ? sf.tools.includes(s.toolId) : sf.need > sf.owned),
      );
      if (!hit) continue;
      const id = s.source.type === "task" ? `task:${s.source.taskId}` : `hold:${s.source.holdId}`;
      const set = out.get(id) ?? new Set<string>();
      if (s.target) set.add(s.target);
      out.set(id, set);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Job filter
// ---------------------------------------------------------------------------

/** Every job that appears in the data, by name: scheduled jobs plus hold-only ones. */
export function jobsInView(
  jobs: { id: string; name: string }[],
  rows: Pick<KindSchedule, "spans">[],
): { id: string; name: string }[] {
  const m = new Map(jobs.map((j) => [j.id, j.name]));
  for (const r of rows) for (const s of r.spans) if (!m.has(s.jobId)) m.set(s.jobId, s.jobName);
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => compareText(a.name, b.name));
}

/**
 * The schedule as if only the jobs not in `hidden` existed: their spans stay,
 * the shortfalls are found again against what is owned, and a tool type is
 * "missing" only if a shown job needs it. A view of what these jobs need, not
 * of what the company needs.
 */
export function filterScheduleByJobs<R extends KindSchedule>(
  rows: R[],
  moves: MoveNeeded[],
  hidden: ReadonlySet<string>,
  from: string,
  to: string,
): { rows: R[]; moves: MoveNeeded[] } {
  if (hidden.size === 0) return { rows, moves };
  return {
    rows: rows.map((r) => {
      const spans = r.spans.filter((s) => !hidden.has(s.jobId));
      return { ...r, spans, shortfalls: findShortfalls(spans, new Set(r.usableToolIds), from, to), missing: r.owned === 0 && spans.length > 0 };
    }),
    moves: moves.filter((m) => !hidden.has(m.jobId)),
  };
}

// ---------------------------------------------------------------------------
// Search and sort
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";

/** Text order that reads digits as numbers: "06 10 00" before "06 20 13", "Saw 2" before "Saw 10". */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** A sorted copy. `dir` turns only the main order; ties always read A–Z by `tie`. */
function sorted<T>(items: T[], main: (a: T, b: T) => number, tie: (a: T, b: T) => number, dir: SortDir): T[] {
  return [...items].sort((a, b) => (dir === "asc" ? main(a, b) : main(b, a)) || tie(a, b));
}

export type ToolSortKey = "name" | "type" | "location" | "tasks";
/** Sort the catalogue's tools. `tasks` is how many rules name the tool. */
export function sortCatalogTools<T extends { id: string; name: string; type: string; at: string }>(
  tools: T[],
  key: ToolSortKey,
  dir: SortDir,
  tasks: (toolId: string) => number,
): T[] {
  const by: Record<ToolSortKey, (a: T, b: T) => number> = {
    name: (a, b) => compareText(a.name, b.name),
    type: (a, b) => Number(!a.type) - Number(!b.type) || compareText(a.type, b.type), // a blank type last
    location: (a, b) => compareText(a.at, b.at),
    tasks: (a, b) => tasks(a.id) - tasks(b.id),
  };
  return sorted(tools, by[key], (a, b) => compareText(a.name, b.name), dir);
}

export type UnresolvedSortKey = "tasks" | "name" | "job" | "phase";
export function sortUnresolved<U extends { name: string; phase: string; jobNames: string[]; taskIds: string[] }>(
  list: U[],
  key: UnresolvedSortKey,
  dir: SortDir,
): U[] {
  const by: Record<UnresolvedSortKey, (a: U, b: U) => number> = {
    tasks: (a, b) => a.taskIds.length - b.taskIds.length,
    name: (a, b) => compareText(a.name, b.name),
    job: (a, b) => compareText(a.jobNames.join(", "), b.jobNames.join(", ")),
    phase: (a, b) => compareText(a.phase, b.phase),
  };
  return sorted(list, by[key], (a, b) => compareText(a.name, b.name), dir);
}

export type RuleSortKey = "name" | "type" | "tools";
export function sortRules<T extends { label: string; key: string; match: string; targets: string[] }>(
  rules: T[],
  key: RuleSortKey,
  dir: SortDir,
  toolNames: (targets: string[]) => string,
): T[] {
  const name = (r: T) => r.label || r.key;
  const by: Record<RuleSortKey, (a: T, b: T) => number> = {
    name: (a, b) => compareText(name(a), name(b)),
    type: (a, b) => compareText(a.match, b.match),
    tools: (a, b) => compareText(toolNames(a.targets), toolNames(b.targets)),
  };
  return sorted(rules, by[key], (a, b) => compareText(name(a), name(b)), dir);
}
