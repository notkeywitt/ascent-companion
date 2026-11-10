// The tool schedule's rules — pure functions, no I/O (TOOL_SCHEDULE_PLAN.md).
//
// A schedule task needs the tool types its rule names, on every day it runs.
// JobTread keeps no tool on a task, so the rules live here: the office ticks
// tools on a PHASE (covers every task under it) and on a TASK NAME where a
// task needs something else (it then applies on every job). A booking puts a
// tool on a job, or a place, by hand — no task needed.

import type { ScheduleTask } from "@/lib/jobtread";

/**
 * How a rule matches a task. Tried in this order; the first level with a rule
 * wins, so a task name overrides its phase.
 * - `task`: one task id (an override for one job).
 * - `name`: the normalized task name.
 * - `taskType`: a JobTread task type id (only once the office sets types).
 * - `phase`: the normalized name of the task's parent group row.
 */
export type RuleMatch = "task" | "name" | "taskType" | "phase";
export const RULE_ORDER: readonly RuleMatch[] = ["task", "name", "taskType", "phase"];

export interface TaskToolRule {
  match: RuleMatch;
  key: string;
  /** The tool types it needs. Empty = "needs no tools": covered, but needs nothing. */
  kindIds: string[];
}

export interface ToolKind {
  id: string;
  name: string;
}

/** One physical tool from the Tools sheet, tagged with its tool type. */
export interface OwnedTool {
  id: string;
  kindId: string;
  name?: string;
  condition?: string;
  /** Where the sheet says it is now, as text ("Shop", "Smith - Studio"). */
  locationLabel?: string;
  /** That location as a JobTread job id, when it matches one (`matchJobByLabel`). */
  jobId?: string | null;
}

/**
 * A tool booked by hand, outside the schedule: for a JobTread job (`jobId`),
 * or for a place that is not a job (`jobId` "" and `jobName` "Shop",
 * "Out for repair", "Loaned to …").
 */
export interface ToolHold {
  id: string;
  kindId: string;
  jobId: string;
  jobName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  qty: number;
  note: string;
}

/** The id a booking for a place (not a job) is counted under. */
export const placeId = (place: string) => `place:${normalizeTaskName(place) || "other"}`;
export const isPlaceId = (id: string) => id.startsWith("place:");

export type SpanSource =
  | { type: "task"; taskId: string; taskName: string; via: RuleMatch }
  | { type: "hold"; holdId: string; note: string };

/** One job (or place) needing one tool type over a date span. */
export interface DemandSpan {
  kindId: string;
  jobId: string;
  jobName: string;
  startDate: string;
  endDate: string;
  qty: number;
  source: SpanSource;
}

/** Task names that no rule covers — the editor's "needs tools" list. */
export interface UnresolvedName {
  key: string; // normalized name
  name: string; // as first seen
  phase: string;
  jobNames: string[];
  taskIds: string[];
}

/** Days where a tool type is needed by more jobs than the company owns. */
export interface Shortfall {
  startDate: string;
  endDate: string;
  /** The highest number needed on any day of the period. */
  need: number;
  owned: number;
  jobIds: string[];
}

export interface KindSchedule {
  kindId: string;
  name: string;
  owned: number;
  spans: DemandSpan[];
  shortfalls: Shortfall[];
  /** Needed in the range, and none owned. */
  missing: boolean;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The key a task name or phase name matches on. Case, punctuation, "&" vs
 * "and" and parenthesized asides ("(if needed)", "Door(s)") don't change it.
 */
export function normalizeTaskName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The key a rule of this match type uses for this task, or null if none. */
export function ruleKeyFor(task: ScheduleTask, match: RuleMatch): string | null {
  switch (match) {
    case "task":
      return task.id || null;
    case "name":
      return normalizeTaskName(task.name) || null;
    case "taskType":
      return task.taskTypeId || null;
    case "phase":
      return normalizeTaskName(task.phase) || null;
  }
}

/** The key a rule is stored and looked up under: names and phases normalized. */
export function ruleKey(match: RuleMatch, key: string): string {
  return match === "name" || match === "phase" ? normalizeTaskName(key) : key.trim();
}

export type RuleIndex = Map<string, TaskToolRule>;
const indexKey = (match: RuleMatch, key: string) => `${match}:${key}`;

export function buildRuleIndex(rules: TaskToolRule[]): RuleIndex {
  const idx: RuleIndex = new Map();
  for (const r of rules) {
    const key = ruleKey(r.match, r.key);
    if (key) idx.set(indexKey(r.match, key), r);
  }
  return idx;
}

export interface Resolution {
  kindIds: string[];
  via: RuleMatch;
}

/** The tool types a task needs, or null when no rule covers it. */
export function resolveTaskTools(task: ScheduleTask, idx: RuleIndex): Resolution | null {
  for (const match of RULE_ORDER) {
    const key = ruleKeyFor(task, match);
    if (!key) continue;
    const r = idx.get(indexKey(match, key));
    if (r) return { kindIds: r.kindIds, via: match };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const STOP = new Set([
  "and", "the", "of", "a", "an", "to", "for", "in", "on", "at", "with", "install", "installation",
  "materials", "material", "subs", "sub", "labor", "misc", "miscellaneous", "if", "needed", "new",
]);

/** Crude stem, so "Footings" meets "Footing" and "Framing" meets "Frame". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith("e")) return w.slice(0, -1);
  return w;
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeTaskName(s)
      .split(" ")
      .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
      .map(stem),
  );
}

/**
 * Up to `n` tool types to offer for a task name, learned from what is already
 * mapped: a rule whose name shares words with this one lends its tools (a word
 * shared with the task name counts 2, with its phase 1), and a tool type whose
 * own name appears in the task counts too. A suggestion only.
 */
export function suggestTools(
  task: Pick<ScheduleTask, "name" | "phase">,
  rules: TaskToolRule[],
  kinds: ToolKind[],
  n = 3,
): string[] {
  const nameT = tokens(task.name);
  const phaseT = tokens(task.phase);
  if (nameT.size === 0 && phaseT.size === 0) return [];
  const known = new Set(kinds.map((k) => k.id));
  const score = new Map<string, number>();
  const add = (id: string, by: number) => known.has(id) && by > 0 && score.set(id, (score.get(id) ?? 0) + by);
  for (const r of rules) {
    if (r.match !== "name" && r.match !== "phase") continue;
    let shared = 0;
    for (const t of tokens(r.key)) shared += nameT.has(t) ? 2 : phaseT.has(t) ? 1 : 0;
    for (const id of r.kindIds) add(id, shared);
  }
  for (const k of kinds) {
    let shared = 0;
    for (const t of tokens(k.name)) shared += nameT.has(t) ? 3 : 0;
    add(k.id, shared);
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

/**
 * Turn tasks + bookings into demand spans per tool type, and collect the task
 * names no rule covers. A task whose rule says "needs no tools", or names only
 * tool types since deleted, adds no span.
 */
export function buildDemand(
  tasks: ScheduleTask[],
  rules: TaskToolRule[],
  kinds: ToolKind[],
  holds: ToolHold[] = [],
): { spans: DemandSpan[]; unresolved: UnresolvedName[] } {
  const idx = buildRuleIndex(rules);
  const kindIds = new Set(kinds.map((k) => k.id));
  const spans: DemandSpan[] = [];
  const unresolved = new Map<string, UnresolvedName>();
  for (const t of tasks) {
    const res = resolveTaskTools(t, idx);
    if (!res) {
      const key = normalizeTaskName(t.name);
      const u = unresolved.get(key) ?? { key, name: t.name, phase: t.phase, jobNames: [], taskIds: [] };
      if (t.jobName && !u.jobNames.includes(t.jobName)) u.jobNames.push(t.jobName);
      u.taskIds.push(t.id);
      unresolved.set(key, u);
      continue;
    }
    for (const kindId of new Set(res.kindIds)) {
      if (!kindIds.has(kindId)) continue;
      spans.push({
        kindId,
        jobId: t.jobId,
        jobName: t.jobName,
        startDate: t.startDate,
        endDate: t.endDate,
        qty: 1,
        source: { type: "task", taskId: t.id, taskName: t.name, via: res.via },
      });
    }
  }
  for (const h of holds) {
    if (!kindIds.has(h.kindId)) continue;
    spans.push({
      kindId: h.kindId,
      jobId: h.jobId || placeId(h.jobName),
      jobName: h.jobName || "Not a job",
      startDate: h.startDate,
      endDate: h.endDate,
      qty: Math.max(1, Math.floor(h.qty || 1)),
      source: { type: "hold", holdId: h.id, note: h.note },
    });
  }
  spans.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.jobName.localeCompare(b.jobName));
  return {
    spans,
    unresolved: [...unresolved.values()].sort((a, b) => b.taskIds.length - a.taskIds.length || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// Supply and shortfalls
// ---------------------------------------------------------------------------

/** A tool in this condition can't go to a job. Other conditions count as usable. */
export function isUsable(condition: string | undefined): boolean {
  return !/broken|repair|lost|stolen|retired|missing|dead/i.test(condition ?? "");
}

const DAY_MS = 86_400_000;
export const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const dayIso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * The periods inside `from`..`to` where the jobs needing a tool type outnumber
 * the usable ones owned. A job counts once per day — two of its tasks on the
 * same day share the tool — unless a hold asks that job for more.
 */
export function findShortfalls(spans: DemandSpan[], owned: number, from: string, to: string): Shortfall[] {
  const f = dayNum(from);
  const t = dayNum(to);
  const ranged = spans
    .map((s) => ({ s, a: Math.max(f, dayNum(s.startDate)), b: Math.min(t, dayNum(s.endDate)) }))
    .filter((x) => x.a <= x.b);
  type Period = { a: number; b: number; need: number; jobs: Set<string> };
  const periods: Period[] = [];
  let cur: Period | null = null;
  for (let d = f; d <= t; d++) {
    const perJob = new Map<string, number>();
    for (const x of ranged)
      if (x.a <= d && x.b >= d) perJob.set(x.s.jobId, Math.max(perJob.get(x.s.jobId) ?? 0, x.s.qty));
    let need = 0;
    for (const q of perJob.values()) need += q;
    if (need <= owned) {
      cur = null;
      continue;
    }
    if (cur && cur.b === d - 1) {
      cur.b = d;
      cur.need = Math.max(cur.need, need);
      for (const j of perJob.keys()) cur.jobs.add(j);
    } else {
      cur = { a: d, b: d, need, jobs: new Set(perJob.keys()) };
      periods.push(cur);
    }
  }
  return periods.map((p) => ({
    startDate: dayIso(p.a),
    endDate: dayIso(p.b),
    need: p.need,
    owned,
    jobIds: [...p.jobs],
  }));
}

/** One row per tool type: its demand in range, what is owned, and the gaps. */
export function scheduleByKind(
  kinds: ToolKind[],
  spans: DemandSpan[],
  tools: OwnedTool[],
  from: string,
  to: string,
): KindSchedule[] {
  const f = dayNum(from);
  const t = dayNum(to);
  return kinds.map((k) => {
    const mine = spans.filter((s) => s.kindId === k.id && dayNum(s.endDate) >= f && dayNum(s.startDate) <= t);
    const owned = tools.filter((x) => x.kindId === k.id && isUsable(x.condition)).length;
    return {
      kindId: k.id,
      name: k.name,
      owned,
      spans: mine,
      shortfalls: findShortfalls(mine, owned, from, to),
      missing: owned === 0 && mine.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/**
 * The JobTread job a Tools-sheet location names, or null. A sheet location is
 * a Project Database row labelled "Customer - Project"; its id is not a
 * JobTread id, so the match is on the project part of the label (or the whole
 * label), compared as normalized names. A label that could be two jobs is null.
 */
export function matchJobByLabel(label: string | undefined, jobs: { id: string; name: string }[]): string | null {
  const raw = (label ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(" - ");
  const tries = [normalizeTaskName(parts[parts.length - 1]), normalizeTaskName(raw)];
  for (const key of tries) {
    if (!key) continue;
    const hits = jobs.filter((j) => normalizeTaskName(j.name) === key);
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return null;
  }
  return null;
}

/** A tool type a job needs soon, with none of that type there yet. */
export interface MoveNeeded {
  kindId: string;
  kindName: string;
  jobId: string;
  jobName: string;
  /** The first day the job needs it (or `from`, when it already does). */
  by: string;
  /** Where the usable tools of that type are now. */
  toolsAt: { name: string; at: string }[];
}

/**
 * For each tool type and each job that needs it in `from`..`to`: a move is
 * needed when no usable tool of that type sits at that job. A tool type with
 * none owned is "missing" instead, so it gets no move. Soonest first.
 */
export function findMoves(rows: KindSchedule[], tools: OwnedTool[], from: string, to: string): MoveNeeded[] {
  const out: MoveNeeded[] = [];
  for (const row of rows) {
    const usable = tools.filter((t) => t.kindId === row.kindId && isUsable(t.condition));
    if (usable.length === 0) continue;
    const firstByJob = new Map<string, DemandSpan>();
    for (const s of row.spans) {
      if (s.endDate < from || s.startDate > to) continue;
      if (isPlaceId(s.jobId)) continue; // a booking for the Shop or a repair is not a move to a job
      const cur = firstByJob.get(s.jobId);
      if (!cur || s.startDate < cur.startDate) firstByJob.set(s.jobId, s);
    }
    for (const [jobId, s] of firstByJob) {
      if (usable.some((t) => t.jobId === jobId)) continue;
      out.push({
        kindId: row.kindId,
        kindName: row.name,
        jobId,
        jobName: s.jobName,
        by: s.startDate < from ? from : s.startDate,
        toolsAt: usable.map((t) => ({ name: t.name ?? t.id, at: t.locationLabel || "No location" })),
      });
    }
  }
  return out.sort((a, b) => a.by.localeCompare(b.by) || a.kindName.localeCompare(b.kindName));
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

export const isIsoDay = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(dayNum(s));

/** `from` plus whole months, less a day: Nov 10 + 6 months → May 9. */
export function monthsAhead(from: string, months: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  // Feb 30 rolls into March; step back to the month's last day instead.
  if (target.getUTCDate() !== d.getUTCDate()) target.setUTCDate(0);
  return dayIso(dayNum(target.toISOString().slice(0, 10)) - 1);
}

/** The longest range the schedule reads: a little over a year. */
export const MAX_RANGE_DAYS = 400;
