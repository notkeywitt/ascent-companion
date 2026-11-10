import { getJobs, getUpcomingScheduleTasks } from "@/lib/jobtread";
import { getPaveConfig } from "@/lib/config";
import { orgDay } from "@/lib/orgTime";
import {
  buildDemand,
  dayIso,
  dayNum,
  isIsoDay,
  MAX_RANGE_DAYS,
  monthsAhead,
  findMoves,
  isUsable,
  matchJobByLabel,
  buildRuleIndex,
  normalizeTaskName,
  resolveTaskTools,
  scheduleByKind,
  suggestTools,
  type KindSchedule,
  type RuleMatch,
  type MoveNeeded,
  type OwnedTool,
  type UnresolvedName,
} from "@/lib/toolSchedule";
import { getSheetTools, loadPlan, type ExcludedJob, type SheetTool, type StoredPlan } from "@/lib/toolScheduleStore";

/**
 * Everything the tool schedule page draws, built on the server: the JobTread
 * schedule (read only), the stored plan and the Tools sheet, run through the
 * pure rules in `toolSchedule.ts`.
 */

export interface KindTool {
  id: string;
  name: string;
  condition: string;
  usable: boolean;
  at: string;
}
export interface ToolScheduleRow extends KindSchedule {
  tools: KindTool[];
}
export interface ToolSchedulePayload {
  from: string;
  to: string;
  rows: ToolScheduleRow[];
  moves: MoveNeeded[];
  unresolvedCount: number;
  /** Jobs with tasks in the range, in first-task order. */
  jobs: { id: string; name: string }[];
  /** Jobs whose schedule stops before `to`: their later needs are not counted. */
  endsEarly: { id: string; name: string; lastDay: string }[];
  excludes: ExcludedJob[];
  /** Set when the Tools sheet could not be read: every owned count is then 0. */
  toolsError?: string;
}

async function sheetToolsOrError(): Promise<{ tools: SheetTool[]; error?: string }> {
  try {
    return { tools: await getSheetTools() };
  } catch (e) {
    return { tools: [], error: e instanceof Error ? e.message : "Could not read the Tools sheet." };
  }
}

/** The schedule's open tasks in range, less the jobs the office left out. */
async function readTasks(from: string, to: string, plan: StoredPlan) {
  const cfg = getPaveConfig();
  const out = new Set(plan.excludes.map((e) => e.jobId));
  const tasks = await getUpcomingScheduleTasks(cfg, from, to);
  return tasks.filter((t) => !out.has(t.jobId));
}

export async function buildToolSchedule(from: string, to: string): Promise<ToolSchedulePayload> {
  const cfg = getPaveConfig();
  const plan = await loadPlan();
  const [tasks, sheet, jobs] = await Promise.all([
    readTasks(from, to, plan),
    sheetToolsOrError(),
    getJobs(cfg).catch(() => []),
  ]);

  const jobRefs = jobs.map((j) => ({ id: j.id, name: j.name }));
  const owned: OwnedTool[] = sheet.tools
    .filter((t) => plan.members[t.id])
    .map((t) => ({
      id: t.id,
      kindId: plan.members[t.id],
      name: t.name,
      condition: t.condition,
      locationLabel: t.locationLabel,
      jobId: matchJobByLabel(t.locationLabel, jobRefs),
    }));

  const { spans, unresolved } = buildDemand(tasks, plan.rules, plan.kinds, plan.holds);
  const kindRows = scheduleByKind(plan.kinds, spans, owned, from, to);
  const rows: ToolScheduleRow[] = kindRows.map((r) => ({
    ...r,
    tools: owned
      .filter((t) => t.kindId === r.kindId)
      .map((t) => ({
        id: t.id,
        name: t.name ?? t.id,
        condition: t.condition ?? "",
        usable: isUsable(t.condition),
        at: t.locationLabel || "No location",
      })),
  }));

  const jobOrder = new Map<string, { id: string; name: string; first: string; last: string }>();
  for (const t of tasks) {
    const j = jobOrder.get(t.jobId);
    if (!j) jobOrder.set(t.jobId, { id: t.jobId, name: t.jobName, first: t.startDate, last: t.endDate });
    else {
      if (t.startDate < j.first) j.first = t.startDate;
      if (t.endDate > j.last) j.last = t.endDate;
    }
  }
  const scheduled = [...jobOrder.values()].sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name));

  return {
    from,
    to,
    rows,
    moves: findMoves(kindRows, owned, from, to),
    unresolvedCount: unresolved.length,
    jobs: scheduled.map((j) => ({ id: j.id, name: j.name })),
    endsEarly: scheduled
      .filter((j) => j.last < to)
      .map((j) => ({ id: j.id, name: j.name, lastDay: j.last }))
      .sort((a, b) => a.lastDay.localeCompare(b.lastDay)),
    excludes: plan.excludes,
    ...(sheet.error ? { toolsError: sheet.error } : {}),
  };
}

export interface UnresolvedWithSuggestions extends UnresolvedName {
  /** Up to three tool type ids, learned from what is already mapped. */
  suggestions: string[];
}

/** A task name under a phase, and the level its tools come from (null = none yet). */
export interface PhaseTaskName {
  key: string;
  name: string;
  taskCount: number;
  via: RuleMatch | null;
}
export interface PhaseRow {
  key: string; // normalized phase name
  name: string;
  taskCount: number;
  jobNames: string[];
  names: PhaseTaskName[];
}
export interface TaskTypeRow {
  id: string;
  name: string;
  taskCount: number;
}

/**
 * What the editor's Tasks tab needs: the phases and task types the schedule
 * uses in range, every task name under each phase with where its tools come
 * from, and the task names nothing covers yet (with suggested tool types).
 */
export async function taskRules(from: string, to: string): Promise<{
  plan: StoredPlan;
  phases: PhaseRow[];
  taskTypes: TaskTypeRow[];
  unresolved: UnresolvedWithSuggestions[];
}> {
  const plan = await loadPlan();
  const tasks = await readTasks(from, to, plan);
  const idx = buildRuleIndex(plan.rules);
  const phases = new Map<string, PhaseRow & { jobs: Set<string>; byName: Map<string, PhaseTaskName> }>();
  const types = new Map<string, TaskTypeRow>();
  for (const t of tasks) {
    if (t.taskTypeId) {
      const ty = types.get(t.taskTypeId) ?? { id: t.taskTypeId, name: t.taskTypeName ?? t.taskTypeId, taskCount: 0 };
      ty.taskCount++;
      types.set(t.taskTypeId, ty);
    }
    const pk = normalizeTaskName(t.phase);
    if (!pk) continue;
    const ph = phases.get(pk) ?? { key: pk, name: t.phase, taskCount: 0, jobNames: [], names: [], jobs: new Set<string>(), byName: new Map() };
    ph.taskCount++;
    if (t.jobName) ph.jobs.add(t.jobName);
    const nk = normalizeTaskName(t.name);
    const n = ph.byName.get(nk) ?? { key: nk, name: t.name, taskCount: 0, via: resolveTaskTools(t, idx)?.via ?? null };
    n.taskCount++;
    ph.byName.set(nk, n);
    phases.set(pk, ph);
  }
  const { unresolved } = buildDemand(tasks, plan.rules, plan.kinds);
  return {
    plan,
    phases: [...phases.values()]
      .map(({ jobs, byName, ...p }) => ({ ...p, jobNames: [...jobs].sort(), names: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => b.taskCount - a.taskCount || a.name.localeCompare(b.name)),
    taskTypes: [...types.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unresolved: unresolved.map((u) => ({ ...u, suggestions: suggestTools({ name: u.name, phase: u.phase }, plan.rules, plan.kinds) })),
  };
}

/** Every job with schedule tasks in range, each marked left out or not. */
export async function scheduledJobs(from: string, to: string): Promise<{ id: string; name: string; excluded: boolean; tasks: number }[]> {
  const plan = await loadPlan();
  const tasks = await getUpcomingScheduleTasks(getPaveConfig(), from, to);
  const out = new Set(plan.excludes.map((e) => e.jobId));
  const byJob = new Map<string, { id: string; name: string; excluded: boolean; tasks: number }>();
  for (const t of tasks) {
    const j = byJob.get(t.jobId) ?? { id: t.jobId, name: t.jobName, excluded: out.has(t.jobId), tasks: 0 };
    j.tasks++;
    byJob.set(t.jobId, j);
  }
  // A left-out job with nothing in range still shows, so it can be put back.
  for (const e of plan.excludes) if (!byJob.has(e.jobId)) byJob.set(e.jobId, { id: e.jobId, name: e.jobName, excluded: true, tasks: 0 });
  return [...byJob.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The range a request asks for: `?from=YYYY-MM-DD&to=YYYY-MM-DD`, or `?months=N`
 * from today (org time). Defaults to 6 months, the owner's planning horizon.
 */
export function rangeFromUrl(url: URL, today = orgDay(new Date().toISOString())): { from: string; to: string } {
  const q = url.searchParams;
  const from = isIsoDay(q.get("from")) ? (q.get("from") as string) : today;
  const months = Math.min(12, Math.max(1, Number(q.get("months")) || 6));
  let to = isIsoDay(q.get("to")) ? (q.get("to") as string) : monthsAhead(from, months);
  if (to < from) to = from;
  if (dayNum(to) - dayNum(from) > MAX_RANGE_DAYS) to = dayIso(dayNum(from) + MAX_RANGE_DAYS);
  return { from, to };
}
