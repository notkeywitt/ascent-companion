// The tool schedule's rules — pure functions, no I/O (TOOL_SCHEDULE_PLAN.md).
//
// The catalogue IS the tool tracker: every tool in the Tools list, typed by its
// ToolType column. A schedule task needs what its rule names — a specific tool
// ("tool:<id>") or any tool of a type ("type:<key>"). JobTread keeps no tool on
// a task, so the rules live here: the office names tools on a PHASE (covers
// every task under it) and on a TASK NAME for what a task needs beyond its
// phase (that applies on every job). A booking puts a tool on a job, or a place, by
// hand — no task needed.

import type { ScheduleTask } from "@/lib/jobtread";

/**
 * How a rule matches a task, most specific first. A task needs what every
 * level's rule names, added together — its phase's tools plus its own — except
 * that a "needs no tools" rule stops the levels after it (an inspection under a
 * framing phase needs no saw).
 * - `task`: one task id (an override for one job).
 * - `name`: the normalized task name.
 * - `taskType`: a JobTread task type id (only once the office sets types).
 * - `phase`: the normalized name of the task's parent group row.
 */
export type RuleMatch = "task" | "name" | "taskType" | "phase";
export const RULE_ORDER: readonly RuleMatch[] = ["task", "name", "taskType", "phase"];

// ---------------------------------------------------------------------------
// Names and targets
// ---------------------------------------------------------------------------

/**
 * The key a task name, phase name or tool type matches on. Case, punctuation,
 * "&" vs "and" and parenthesized asides ("(if needed)", "Door(s)") don't change it.
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

/** The type a Tools-list tool with a blank ToolType falls under. */
export const UNTYPED = "untyped";

/** A tool type's key: its normalized name ("Laser Level " → "laser level"). */
export const typeKey = (name: string) => normalizeTaskName(name) || UNTYPED;

/**
 * What a rule or a booking asks for: one tool ("tool:<Tools-list id>") or any
 * tool of a type ("type:<type key>").
 */
export type Target = string;
export const toolTarget = (toolId: string): Target => `tool:${toolId}`;
export const typeTarget = (typeName: string): Target => `type:${typeKey(typeName)}`;
export function parseTarget(t: string): { tool: string } | { type: string } | null {
  if (t.startsWith("tool:") && t.length > 5) return { tool: t.slice(5) };
  if (t.startsWith("type:") && t.length > 5) return { type: t.slice(5) };
  return null;
}

export interface TaskToolRule {
  match: RuleMatch;
  key: string;
  /** What it needs. Empty = "needs no tools": covered, but needs nothing. */
  targets: Target[];
}

/** A tool type: one the Tools list has, or one the office added by hand. */
export interface ToolKind {
  id: string; // the type key
  name: string;
}

/** One tool from the Tools list. */
export interface OwnedTool {
  id: string;
  /** Its type key (`typeKey(ToolType)`). */
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
  target: Target;
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
  | { type: "task"; taskId: string; taskName: string; via: RuleMatch; ruleKey: string }
  | { type: "hold"; holdId: string; note: string };

/** One job (or place) needing one tool — a specific one, or any of a type — over a date span. */
export interface DemandSpan {
  /** The tool type's key: the Gantt row it sits on. */
  kindId: string;
  /** Set when a specific tool is named; absent when any tool of the type will do. */
  toolId?: string;
  toolName?: string;
  jobId: string;
  jobName: string;
  startDate: string;
  endDate: string;
  qty: number;
  source: SpanSource;
}

/** Task names that no rule covers — the editor's "no tools yet" list. */
export interface UnresolvedName {
  key: string; // normalized name
  name: string; // as first seen
  phase: string;
  jobNames: string[];
  taskIds: string[];
}

/** Days where a tool type is needed by more jobs than are free, or one tool is booked twice. */
export interface Shortfall {
  startDate: string;
  endDate: string;
  /** The highest number needed on any day of the period. */
  need: number;
  owned: number;
  jobIds: string[];
  /** Specific tools booked for two jobs at once, or named while broken. */
  tools: string[];
}

export interface KindSchedule {
  kindId: string;
  name: string;
  owned: number;
  /** The usable tools of this type, so a filtered view can find shortfalls again. */
  usableToolIds: string[];
  spans: DemandSpan[];
  shortfalls: Shortfall[];
  /** Needed in the range, and none owned. */
  missing: boolean;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

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

/** One thing a task needs, and the rule that asked for it. */
export interface Need {
  target: Target;
  via: RuleMatch;
  /** `${via}:${key}` — which rule it was. */
  ruleKey: string;
}
export interface Resolution {
  needs: Need[];
  /** The most specific level with a rule. */
  via: RuleMatch;
}

/**
 * What a task needs, or null when no rule covers it: every level's targets,
 * most specific first, until a "needs no tools" rule stops the rest.
 */
export function resolveTaskTools(task: ScheduleTask, idx: RuleIndex): Resolution | null {
  let via: RuleMatch | null = null;
  const needs: Need[] = [];
  const seen = new Set<string>();
  for (const match of RULE_ORDER) {
    const key = ruleKeyFor(task, match);
    if (!key) continue;
    const r = idx.get(indexKey(match, key));
    if (!r) continue;
    via ??= match;
    if (r.targets.length === 0) break;
    for (const target of r.targets) {
      if (seen.has(target)) continue;
      seen.add(target);
      needs.push({ target, via: match, ruleKey: indexKey(match, key) });
    }
  }
  return via ? { needs, via } : null;
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
 * Up to `n` targets to offer for a task name, learned from what is already
 * mapped: a rule whose name shares words with this one lends what it names (a
 * word shared with the task name counts 2, with its phase 1), and a tool type
 * whose own name appears in the task counts too. A suggestion only.
 */
export function suggestTools(
  task: Pick<ScheduleTask, "name" | "phase">,
  rules: TaskToolRule[],
  kinds: ToolKind[],
  tools: OwnedTool[] = [],
  n = 3,
): Target[] {
  const nameT = tokens(task.name);
  const phaseT = tokens(task.phase);
  if (nameT.size === 0 && phaseT.size === 0) return [];
  const known = new Set([...kinds.map((k) => `type:${k.id}`), ...tools.map((t) => toolTarget(t.id))]);
  const score = new Map<string, number>();
  const add = (t: string, by: number) => known.has(t) && by > 0 && score.set(t, (score.get(t) ?? 0) + by);
  for (const r of rules) {
    if (r.match !== "name" && r.match !== "phase") continue;
    let shared = 0;
    for (const t of tokens(r.key)) shared += nameT.has(t) ? 2 : phaseT.has(t) ? 1 : 0;
    for (const t of r.targets) add(t, shared);
  }
  for (const k of kinds) {
    let shared = 0;
    for (const t of tokens(k.name)) shared += nameT.has(t) ? 3 : 0;
    add(`type:${k.id}`, shared);
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([t]) => t);
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

/**
 * Turn tasks + bookings into demand spans, and collect the task names no rule
 * covers. A rule that says "needs no tools", or names a tool no longer in the
 * Tools list, adds no span. A type with no tools still gets spans: that is
 * how "none owned" shows.
 */
export function buildDemand(
  tasks: ScheduleTask[],
  rules: TaskToolRule[],
  tools: OwnedTool[],
  holds: ToolHold[] = [],
): { spans: DemandSpan[]; unresolved: UnresolvedName[] } {
  const idx = buildRuleIndex(rules);
  const toolsById = new Map(tools.map((t) => [t.id, t]));
  /** The span fields a target fills in, or null for a tool no longer listed. */
  const what = (target: Target): Pick<DemandSpan, "kindId" | "toolId" | "toolName"> | null => {
    const p = parseTarget(target);
    if (!p) return null;
    if ("type" in p) return { kindId: p.type };
    const tool = toolsById.get(p.tool);
    return tool ? { kindId: tool.kindId, toolId: tool.id, toolName: tool.name ?? tool.id } : null;
  };

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
    for (const need of res.needs) {
      const w = what(need.target);
      if (!w) continue;
      spans.push({
        ...w,
        jobId: t.jobId,
        jobName: t.jobName,
        startDate: t.startDate,
        endDate: t.endDate,
        qty: 1,
        source: { type: "task", taskId: t.id, taskName: t.name, via: need.via, ruleKey: need.ruleKey },
      });
    }
  }
  for (const h of holds) {
    const w = what(h.target);
    if (!w) continue;
    spans.push({
      ...w,
      jobId: h.jobId || placeId(h.jobName),
      jobName: h.jobName || "Not a job",
      startDate: h.startDate,
      endDate: h.endDate,
      qty: w.toolId ? 1 : Math.max(1, Math.floor(h.qty || 1)),
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
 * The periods inside `from`..`to` where one tool type runs short. On each day:
 * - a specific tool counts once for each job that names it — so a tool named
 *   by two jobs at once, or named while broken, is a shortfall by itself;
 * - "any tool of the type" counts once per job (a job's largest booking
 *   quantity), less the specific tools of that type already at that job;
 * - short when the total is more than the usable tools owned.
 */
export function findShortfalls(spans: DemandSpan[], usableToolIds: ReadonlySet<string>, from: string, to: string): Shortfall[] {
  const f = dayNum(from);
  const t = dayNum(to);
  const owned = usableToolIds.size;
  const ranged = spans
    .map((s) => ({ s, a: Math.max(f, dayNum(s.startDate)), b: Math.min(t, dayNum(s.endDate)) }))
    .filter((x) => x.a <= x.b);
  type Period = { a: number; b: number; need: number; jobs: Set<string>; tools: Set<string> };
  const periods: Period[] = [];
  let cur: Period | null = null;
  for (let d = f; d <= t; d++) {
    const jobsByTool = new Map<string, Set<string>>();
    const anyByJob = new Map<string, number>();
    for (const x of ranged) {
      if (x.a > d || x.b < d) continue;
      if (x.s.toolId) jobsByTool.set(x.s.toolId, (jobsByTool.get(x.s.toolId) ?? new Set()).add(x.s.jobId));
      else anyByJob.set(x.s.jobId, Math.max(anyByJob.get(x.s.jobId) ?? 0, x.s.qty));
    }
    const specificAt = new Map<string, number>();
    const clash = new Set<string>();
    let need = 0;
    for (const [tool, jobs] of jobsByTool) {
      need += jobs.size;
      if (jobs.size > 1 || !usableToolIds.has(tool)) clash.add(tool);
      for (const j of jobs) specificAt.set(j, (specificAt.get(j) ?? 0) + 1);
    }
    for (const [job, q] of anyByJob) need += Math.max(0, q - (specificAt.get(job) ?? 0));
    if (need <= owned && clash.size === 0) {
      cur = null;
      continue;
    }
    const jobsToday = new Set([...anyByJob.keys(), ...[...jobsByTool.values()].flatMap((s) => [...s])]);
    if (cur && cur.b === d - 1) {
      cur.b = d;
      cur.need = Math.max(cur.need, need);
      for (const j of jobsToday) cur.jobs.add(j);
      for (const c of clash) cur.tools.add(c);
    } else {
      cur = { a: d, b: d, need, jobs: jobsToday, tools: clash };
      periods.push(cur);
    }
  }
  return periods.map((p) => ({
    startDate: dayIso(p.a),
    endDate: dayIso(p.b),
    need: p.need,
    owned,
    jobIds: [...p.jobs],
    tools: [...p.tools],
  }));
}

/**
 * One row per tool type: its demand in range, the usable tools owned, and the
 * gaps. Every type in `kinds` gets a row, and so does a type only a span names.
 */
export function scheduleByKind(
  kinds: ToolKind[],
  spans: DemandSpan[],
  tools: OwnedTool[],
  from: string,
  to: string,
): KindSchedule[] {
  const f = dayNum(from);
  const t = dayNum(to);
  const names = new Map(kinds.map((k) => [k.id, k.name]));
  for (const s of spans) if (!names.has(s.kindId)) names.set(s.kindId, s.kindId);
  return [...names].map(([kindId, name]) => {
    const mine = spans.filter((s) => s.kindId === kindId && dayNum(s.endDate) >= f && dayNum(s.startDate) <= t);
    const usable = tools.filter((x) => x.kindId === kindId && isUsable(x.condition)).map((x) => x.id);
    return {
      kindId,
      name,
      owned: usable.length,
      usableToolIds: usable,
      spans: mine,
      shortfalls: findShortfalls(mine, new Set(usable), from, to),
      missing: usable.length === 0 && mine.length > 0,
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

/** A tool a job needs soon that is not there yet. */
export interface MoveNeeded {
  kindId: string;
  kindName: string;
  /** Set when the job named this exact tool. */
  toolId?: string;
  toolName?: string;
  jobId: string;
  jobName: string;
  /** The first day the job needs it (or `from`, when it already does). */
  by: string;
  /** Where the tool — or the usable tools of the type — are now. */
  toolsAt: { name: string; at: string }[];
}

/**
 * Moves coming up, soonest first:
 * - a named tool, to each job that needs it, when it is somewhere else;
 * - "any tool of the type", to each job that needs one, when no usable tool of
 *   that type is there (and the job named no tool of that type itself).
 * A type with none owned is "missing" instead, and a booking for a place is
 * never a move.
 */
export function findMoves(rows: KindSchedule[], tools: OwnedTool[], from: string, to: string): MoveNeeded[] {
  const out: MoveNeeded[] = [];
  const byId = new Map(tools.map((t) => [t.id, t]));
  const at = (t: OwnedTool) => ({ name: t.name ?? t.id, at: t.locationLabel || "No location" });
  for (const row of rows) {
    const usable = tools.filter((t) => t.kindId === row.kindId && isUsable(t.condition));
    const first = new Map<string, DemandSpan>(); // `${tool or *}|${job}` → earliest span
    for (const s of row.spans) {
      if (s.endDate < from || s.startDate > to || isPlaceId(s.jobId)) continue;
      const k = `${s.toolId ?? "*"}|${s.jobId}`;
      const cur = first.get(k);
      if (!cur || s.startDate < cur.startDate) first.set(k, s);
    }
    const namedAt = new Set([...first.values()].filter((s) => s.toolId).map((s) => s.jobId));
    for (const s of first.values()) {
      const by = s.startDate < from ? from : s.startDate;
      if (s.toolId) {
        const tool = byId.get(s.toolId);
        if (!tool || tool.jobId === s.jobId) continue;
        out.push({ kindId: row.kindId, kindName: row.name, toolId: tool.id, toolName: tool.name ?? tool.id, jobId: s.jobId, jobName: s.jobName, by, toolsAt: [at(tool)] });
      } else {
        if (usable.length === 0 || namedAt.has(s.jobId) || usable.some((t) => t.jobId === s.jobId)) continue;
        out.push({ kindId: row.kindId, kindName: row.name, jobId: s.jobId, jobName: s.jobName, by, toolsAt: usable.map(at) });
      }
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
