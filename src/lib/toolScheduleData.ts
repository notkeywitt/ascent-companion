import { getJobs, getUpcomingScheduleTasks } from "@/lib/jobtread";
import { getPaveConfig } from "@/lib/config";
import { orgDay } from "@/lib/orgTime";
import {
  buildDemand,
  buildRuleIndex,
  dayIso,
  dayNum,
  findMoves,
  isIsoDay,
  isTrailerType,
  isUsable,
  matchJobByLabel,
  MAX_RANGE_DAYS,
  monthsAhead,
  normalizeTaskName,
  parseTarget,
  placeId,
  resolveTaskTools,
  ruleKey,
  scheduleByKind,
  suggestTools,
  typeKey,
  UNTYPED,
  type KindSchedule,
  type MoveNeeded,
  type OwnedTool,
  type RuleMatch,
  type Target,
  type TaskToolRule,
  type ToolHold,
  type ToolKind,
  type UnresolvedName,
} from "@/lib/toolSchedule";
import { getSheetTools, loadPlan, type ExcludedJob, type SheetTool, type StoredPlan } from "@/lib/toolScheduleStore";

/**
 * Everything the tool schedule draws, built on the server: the JobTread
 * schedule (read only), the Tools list (the catalogue) and the stored plan,
 * run through the pure rules in `toolSchedule.ts`.
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
/** One JobTread schedule task in range, for the Gantt: what it needs and why. */
export interface GanttTask {
  id: string;
  jobId: string;
  jobName: string;
  name: string;
  phase: string;
  /** The phase's id and both JobTread sort keys: the Gantt groups and orders by them, as JobTread does. */
  phaseId: string;
  phasePosition: string;
  position: string;
  taskTypeId: string | null;
  startDate: string;
  endDate: string;
  /** What it needs, most specific rule first. Empty when covered by "needs no tools" or by nothing. */
  needs: { target: Target; via: RuleMatch; label: string }[];
  /** False when no rule covers it yet. */
  covered: boolean;
}
/** A booking, for the Gantt: a row under its job (or place). */
export interface GanttBooking extends ToolHold {
  label: string;
  /** The id it is counted under: the job id, or `placeId(place)`. */
  rowJobId: string;
}

export interface ToolSchedulePayload {
  from: string;
  to: string;
  rows: ToolScheduleRow[];
  /** Every open schedule task in range (less left-out jobs), in start order: the Gantt's rows. */
  tasks: GanttTask[];
  bookings: GanttBooking[];
  /** The stored rules, so the task dialog can add to or take from one. */
  rules: TaskToolRule[];
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

/** One tool of the catalogue: a Tools-list row with its type key and job. */
export interface CatalogTool extends KindTool {
  kindId: string;
  type: string;
  /** Its location as a JobTread job id, when the label matches one. */
  jobId: string | null;
  /** Its ToolGroup as typed, and that group's key ("" for none). */
  group: string;
  groupId: string;
  /** A trailer: other tools can ride in it. */
  isTrailer: boolean;
  /** The trailer it rides in, when it does. Its `at` is then the trailer's. */
  trailerId?: string;
}
/** A ToolGroup: tools that go out together, assigned as one. */
export interface CatalogGroup {
  id: string;
  name: string;
  toolIds: string[];
}
export interface CatalogType extends ToolKind {
  /** Usable tools of this type. */
  owned: number;
  /** All tools of this type in the Tools list. */
  total: number;
  /** Added by the office (none in the Tools list); its tool_kinds row id. */
  addedRowId?: string;
}

/**
 * The catalogue: every Tools-list tool, typed by its ToolType, and the types —
 * those the list has plus those the office added. A blank ToolType falls under
 * "No type".
 */
export function buildCatalog(sheet: SheetTool[], plan: StoredPlan, jobs: { id: string; name: string }[]) {
  const raw: CatalogTool[] = sheet.map((t) => ({
    id: t.id,
    name: t.name || t.id,
    type: t.type.trim(),
    kindId: typeKey(t.type),
    condition: t.condition,
    usable: isUsable(t.condition),
    at: t.locationLabel || "No location",
    jobId: matchJobByLabel(t.locationLabel, jobs),
    group: t.toolGroup.trim(),
    groupId: t.toolGroup.trim() ? typeKey(t.toolGroup) : "",
    isTrailer: isTrailerType(t.type),
  }));
  // A tool riding in a trailer is wherever the trailer is.
  const byId = new Map(raw.map((t) => [t.id, t]));
  const tools = raw.map((t): CatalogTool => {
    const trailer = byId.get(plan.trailerOf[t.id] ?? "");
    if (!trailer || !trailer.isTrailer || trailer.id === t.id || t.isTrailer) return t;
    return { ...t, trailerId: trailer.id, at: `In ${trailer.name} · ${trailer.at}`, jobId: trailer.jobId };
  });
  const groups = new Map<string, CatalogGroup>();
  for (const t of tools) {
    if (!t.groupId) continue;
    const g = groups.get(t.groupId) ?? { id: t.groupId, name: t.group, toolIds: [] };
    g.toolIds.push(t.id);
    groups.set(t.groupId, g);
  }
  const types = new Map<string, CatalogType>();
  for (const t of tools) {
    const ty = types.get(t.kindId) ?? { id: t.kindId, name: t.kindId === UNTYPED ? "No type" : t.type, owned: 0, total: 0 };
    ty.total++;
    if (t.usable) ty.owned++;
    types.set(t.kindId, ty);
  }
  for (const a of plan.addedTypes) {
    const ty = types.get(a.id);
    if (ty) ty.addedRowId = a.rowId;
    else types.set(a.id, { id: a.id, name: a.name, owned: 0, total: 0, addedRowId: a.rowId });
  }
  const owned: OwnedTool[] = tools.map((t) => ({
    id: t.id,
    kindId: t.kindId,
    name: t.name,
    condition: t.condition,
    locationLabel: t.at === "No location" ? "" : t.at,
    jobId: t.jobId,
    groupId: t.groupId,
    trailerId: t.trailerId,
  }));
  return {
    tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    types: [...types.values()].sort((a, b) => a.name.localeCompare(b.name)),
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    owned,
  };
}

/** "Makita MAC2400", "Any Compressor", "Suction Cups (group of 4)" — a target as people read it. */
export function targetName(target: Target, catalog: { tools: CatalogTool[]; types: CatalogType[]; groups: CatalogGroup[] }): string {
  const p = parseTarget(target);
  if (!p) return target;
  if ("tool" in p) return catalog.tools.find((t) => t.id === p.tool)?.name ?? "Tool no longer in the Tools list";
  if ("type" in p) return `Any ${catalog.types.find((t) => t.id === p.type)?.name ?? p.type}`;
  const g = catalog.groups.find((x) => x.id === p.group);
  return g ? `${g.name} (group of ${g.toolIds.length})` : "Group no longer in the Tools list";
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
  const [tasks, sheet, jobs] = await Promise.all([readTasks(from, to, plan), sheetToolsOrError(), getJobs(cfg).catch(() => [])]);
  const catalog = buildCatalog(sheet.tools, plan, jobs.map((j) => ({ id: j.id, name: j.name })));

  const { spans, unresolved } = buildDemand(tasks, plan.rules, catalog.owned, plan.holds);
  // A row for every type that is needed, owned, or added by hand.
  const kindRows = scheduleByKind(catalog.types, spans, catalog.owned, from, to).filter(
    (r) => r.spans.length > 0 || catalog.types.some((t) => t.id === r.kindId && (t.total > 0 || t.addedRowId)),
  );
  const rows: ToolScheduleRow[] = kindRows.map((r) => ({
    ...r,
    tools: catalog.tools.filter((t) => t.kindId === r.kindId).map(({ id, name, condition, usable, at }) => ({ id, name, condition, usable, at })),
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

  const idx = buildRuleIndex(plan.rules);
  const ganttTasks: GanttTask[] = tasks
    .map((t) => {
      const res = resolveTaskTools(t, idx);
      return {
        id: t.id,
        jobId: t.jobId,
        jobName: t.jobName,
        name: t.name,
        phase: t.phase,
        phaseId: t.phaseId ?? "",
        phasePosition: t.phasePosition ?? "",
        position: t.position ?? "",
        taskTypeId: t.taskTypeId,
        startDate: t.startDate,
        endDate: t.endDate,
        needs: (res?.needs ?? []).map((n) => ({ target: n.target, via: n.via, label: targetName(n.target, catalog) })),
        covered: !!res,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.name.localeCompare(b.name));
  const bookings: GanttBooking[] = plan.holds
    .filter((h) => h.endDate >= from && h.startDate <= to)
    .map((h) => ({ ...h, label: targetName(h.target, catalog), rowJobId: h.jobId || placeId(h.jobName) }));

  return {
    from,
    to,
    rows,
    tasks: ganttTasks,
    bookings,
    rules: plan.rules.map(({ match, key, targets }) => ({ match, key, targets })),
    moves: findMoves(kindRows, catalog.owned, from, to),
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

/** The catalogue for the editor: tools, types, and whether the Tools list could be read. */
export async function loadCatalog() {
  const plan = await loadPlan();
  const [sheet, jobs] = await Promise.all([sheetToolsOrError(), getJobs(getPaveConfig()).catch(() => [])]);
  return { plan, ...buildCatalog(sheet.tools, plan, jobs.map((j) => ({ id: j.id, name: j.name }))), toolsError: sheet.error };
}

export interface UnresolvedWithSuggestions extends UnresolvedName {
  /** Up to three targets, learned from what is already mapped. */
  suggestions: Target[];
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
 * What the editor needs to connect tools and tasks: the phases and task types
 * the schedule uses in range, every task name under each phase with where its
 * tools come from, the task names nothing covers yet (with suggestions), and
 * the catalogue to pick from.
 */
export async function taskRules(from: string, to: string) {
  const { plan, tools, types, groups, owned, toolsError } = await loadCatalog();
  const tasks = await readTasks(from, to, plan);
  const idx = buildRuleIndex(plan.rules);
  const phases = new Map<string, PhaseRow & { jobs: Set<string>; byName: Map<string, PhaseTaskName> }>();
  const taskTypes = new Map<string, TaskTypeRow>();
  for (const t of tasks) {
    if (t.taskTypeId) {
      const ty = taskTypes.get(t.taskTypeId) ?? { id: t.taskTypeId, name: t.taskTypeName ?? t.taskTypeId, taskCount: 0 };
      ty.taskCount++;
      taskTypes.set(t.taskTypeId, ty);
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
  const { unresolved } = buildDemand(tasks, plan.rules, owned);
  return {
    plan,
    tools,
    types,
    groups,
    toolsError,
    phases: [...phases.values()]
      .map(({ jobs, byName, ...p }) => ({ ...p, jobNames: [...jobs].sort(), names: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => b.taskCount - a.taskCount || a.name.localeCompare(b.name)),
    taskTypes: [...taskTypes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unresolved: unresolved.map((u) => ({ ...u, suggestions: suggestTools({ name: u.name, phase: u.phase }, plan.rules, types, owned) })),
  };
}

/** A tool type a rule asks for that no tool of is free, for one job. */
export interface Shortage {
  kindId: string;
  typeName: string;
  jobId: string;
  jobName: string;
  /** "Customer - Job", as a requisition files it. */
  jobLabel: string;
  /** The first and last day it is short for that job. */
  from: string;
  to: string;
  taskNames: string[];
  /** True when the company owns none at all. */
  noneOwned: boolean;
}

/**
 * After a rule names a tool type: the jobs whose tasks under that rule need
 * one on a day none is free. This is what asks the office whether to file a
 * requisition. A specific tool is not checked here; its clash shows on the schedule.
 */
export async function shortagesFor(match: RuleMatch, key: string, targets: Target[], from: string, to: string): Promise<Shortage[]> {
  const data = await buildToolSchedule(from, to);
  const jobs = await getJobs(getPaveConfig()).catch(() => []);
  const label = new Map(jobs.map((j) => [j.id, j.customer ? `${j.customer} - ${j.name}` : j.name]));
  const wanted = `${match}:${ruleKey(match, key)}`;
  const out: Shortage[] = [];
  for (const t of targets) {
    const p = parseTarget(t);
    if (!p || !("type" in p)) continue;
    const row = data.rows.find((r) => r.kindId === p.type);
    if (!row) continue;
    const mine = row.spans.filter((s) => !s.toolId && s.source.type === "task" && s.source.ruleKey === wanted);
    const byJob = new Map<string, Shortage>();
    for (const s of mine) {
      const hit = row.missing ? { startDate: s.startDate, endDate: s.endDate } : row.shortfalls.find((sf) => sf.jobIds.includes(s.jobId) && s.startDate <= sf.endDate && s.endDate >= sf.startDate);
      if (!hit) continue;
      const a = s.startDate > hit.startDate ? s.startDate : hit.startDate;
      const b = s.endDate < hit.endDate ? s.endDate : hit.endDate;
      const cur = byJob.get(s.jobId) ?? {
        kindId: row.kindId,
        typeName: row.name,
        jobId: s.jobId,
        jobName: s.jobName,
        jobLabel: label.get(s.jobId) ?? s.jobName,
        from: a,
        to: b,
        taskNames: [],
        noneOwned: row.owned === 0,
      };
      if (a < cur.from) cur.from = a;
      if (b > cur.to) cur.to = b;
      if (s.source.type === "task" && !cur.taskNames.includes(s.source.taskName)) cur.taskNames.push(s.source.taskName);
      byJob.set(s.jobId, cur);
    }
    out.push(...[...byJob.values()].sort((x, y) => x.from.localeCompare(y.from)));
  }
  return out;
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
