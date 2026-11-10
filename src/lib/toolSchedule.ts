// The tool schedule's rules — pure functions, no I/O (TOOL_SCHEDULE_PLAN.md).
//
// The chain: a schedule task resolves to a cost code; a tool type is needed for
// a set of cost codes; so a task needs every tool type tied to its code, on
// every day it runs. JobTread links no task to a cost code, so the link comes
// from rules the office keeps (a task NAME maps once and then maps on every job).

import type { CostCodeRef, ScheduleTask } from "@/lib/jobtread";

/**
 * How a rule matches a task. Tried in this order; the first hit wins.
 * - `task`: one task id (an override for one job).
 * - `name`: the normalized task name — the main path.
 * - `taskType`: a JobTread task type id.
 * - `phase`: the normalized name of the task's parent group row.
 */
export type RuleMatch = "task" | "name" | "taskType" | "phase";
export const RULE_ORDER: readonly RuleMatch[] = ["task", "name", "taskType", "phase"];

export interface TaskCodeRule {
  match: RuleMatch;
  key: string;
  /** null = "needs no tools": resolved, but counts toward no tool type. */
  costCodeId: string | null;
}

export interface ToolKind {
  id: string;
  name: string;
  costCodeIds: string[];
}

/** One physical tool from the Tools sheet, tagged with its tool type. */
export interface OwnedTool {
  id: string;
  kindId: string;
  condition?: string;
}

/** A tool reserved for a job by hand, outside the schedule. */
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

export type SpanSource =
  | { type: "task"; taskId: string; taskName: string; costCodeId: string }
  | { type: "hold"; holdId: string; note: string };

/** One job needing one tool type over a date span. */
export interface DemandSpan {
  kindId: string;
  jobId: string;
  jobName: string;
  startDate: string;
  endDate: string;
  qty: number;
  source: SpanSource;
}

/** Task names that no rule resolves — the editor's "needs a code" list. */
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

export type RuleIndex = Map<string, TaskCodeRule>;
const indexKey = (match: RuleMatch, key: string) => `${match}:${key}`;

export function buildRuleIndex(rules: TaskCodeRule[]): RuleIndex {
  const idx: RuleIndex = new Map();
  for (const r of rules) {
    const key = r.match === "name" || r.match === "phase" ? normalizeTaskName(r.key) : r.key;
    if (key) idx.set(indexKey(r.match, key), r);
  }
  return idx;
}

export interface Resolution {
  costCodeId: string | null;
  via: RuleMatch;
}

/** The code a task resolves to, or null when no rule covers it. */
export function resolveTaskCode(task: ScheduleTask, idx: RuleIndex): Resolution | null {
  for (const match of RULE_ORDER) {
    const key = ruleKeyFor(task, match);
    if (!key) continue;
    const r = idx.get(indexKey(match, key));
    if (r) return { costCodeId: r.costCodeId, via: match };
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
 * Up to `n` cost codes whose names share words with the task name (weight 2)
 * or its phase (weight 1). A suggestion only: nothing counts until a person
 * confirms it as a rule.
 */
export function suggestCodes(
  task: Pick<ScheduleTask, "name" | "phase">,
  codes: CostCodeRef[],
  n = 3,
): CostCodeRef[] {
  const nameT = tokens(task.name);
  const phaseT = tokens(task.phase);
  if (nameT.size === 0 && phaseT.size === 0) return [];
  const scored: { c: CostCodeRef; score: number }[] = [];
  for (const c of codes) {
    const ct = tokens(c.name);
    let score = 0;
    for (const t of ct) {
      if (nameT.has(t)) score += 2;
      else if (phaseT.has(t)) score += 1;
    }
    if (score > 0) scored.push({ c, score: score / Math.sqrt(ct.size) });
  }
  scored.sort((a, b) => b.score - a.score || a.c.number.localeCompare(b.c.number));
  return scored.slice(0, n).map((s) => s.c);
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

/**
 * Turn tasks + holds into demand spans per tool type, and collect the task
 * names no rule resolves. A task that resolves to "needs no tools", or to a
 * code no tool type lists, adds no span.
 */
export function buildDemand(
  tasks: ScheduleTask[],
  rules: TaskCodeRule[],
  kinds: ToolKind[],
  holds: ToolHold[] = [],
): { spans: DemandSpan[]; unresolved: UnresolvedName[] } {
  const idx = buildRuleIndex(rules);
  const kindsByCode = new Map<string, string[]>();
  for (const k of kinds)
    for (const c of k.costCodeIds) kindsByCode.set(c, [...(kindsByCode.get(c) ?? []), k.id]);

  const spans: DemandSpan[] = [];
  const unresolved = new Map<string, UnresolvedName>();
  for (const t of tasks) {
    const res = resolveTaskCode(t, idx);
    if (!res) {
      const key = normalizeTaskName(t.name);
      const u = unresolved.get(key) ?? { key, name: t.name, phase: t.phase, jobNames: [], taskIds: [] };
      if (t.jobName && !u.jobNames.includes(t.jobName)) u.jobNames.push(t.jobName);
      u.taskIds.push(t.id);
      unresolved.set(key, u);
      continue;
    }
    if (!res.costCodeId) continue;
    for (const kindId of kindsByCode.get(res.costCodeId) ?? []) {
      spans.push({
        kindId,
        jobId: t.jobId,
        jobName: t.jobName,
        startDate: t.startDate,
        endDate: t.endDate,
        qty: 1,
        source: { type: "task", taskId: t.id, taskName: t.name, costCodeId: res.costCodeId },
      });
    }
  }
  const kindIds = new Set(kinds.map((k) => k.id));
  for (const h of holds) {
    if (!kindIds.has(h.kindId)) continue;
    spans.push({
      kindId: h.kindId,
      jobId: h.jobId,
      jobName: h.jobName,
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
