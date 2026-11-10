import { and, eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db, ensureDb } from "@/db";
import { taskToolNeeds, taskToolRules, toolHolds, toolJobExcludes, toolKinds, toolTrailerItems } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import {
  parseTarget,
  ruleKey,
  RULE_ORDER,
  typeKey,
  type RuleMatch,
  type Target,
  type TaskToolRule,
  type ToolHold,
} from "@/lib/toolSchedule";

/**
 * The tool schedule's stored plan (docs/plans/TOOL_SCHEDULE_PLAN.md): the tool
 * types the office added by hand, the task → tool rules, bookings and left-out
 * jobs. The tools themselves, and their types, are the Tools list
 * (`getSheetTools`). All companion data — nothing here writes to JobTread. The
 * rules that use it are pure, in `toolSchedule.ts`.
 */

/** A tool type the office added because the Tools list has none of it. */
export interface AddedType {
  /** The tool_kinds row id, for deleting it. */
  rowId: string;
  /** The type key (`typeKey(name)`). */
  id: string;
  name: string;
}
export interface StoredRule extends TaskToolRule {
  /** The task or phase name as a person saw it, for the list of rules. */
  label: string;
  updatedBy: string;
  updatedAt: string;
}
export interface ExcludedJob {
  jobId: string;
  jobName: string;
}
export interface StoredPlan {
  addedTypes: AddedType[];
  rules: StoredRule[];
  holds: ToolHold[];
  excludes: ExcludedJob[];
  /** Tool id → the trailer (tool id) it rides in. */
  trailerOf: Record<string, string>;
}

const now = () => new Date().toISOString();

export async function loadPlan(): Promise<StoredPlan> {
  await ensureDb();
  const [kinds, needRows, oldRuleRows, holds, excludes, loads] = await Promise.all([
    db.select().from(toolKinds),
    db.select().from(taskToolNeeds),
    db.select().from(taskToolRules),
    db.select().from(toolHolds),
    db.select().from(toolJobExcludes),
    db.select().from(toolTrailerItems),
  ]);
  // A tool kind (the round-3 catalogue) reads as the type of the same name.
  const kindType = new Map(kinds.map((k) => [k.id, `type:${typeKey(k.name)}`]));
  return {
    addedTypes: kinds
      .map((k) => ({ rowId: String(k.id), id: typeKey(k.name), name: k.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rules: groupRules(needRows, oldRuleRows, kindType),
    holds: holds
      .map((h) => ({
        id: String(h.id),
        target: h.target || kindType.get(h.kindId) || "",
        jobId: h.jobId,
        jobName: h.jobName,
        startDate: h.startDate,
        endDate: h.endDate,
        qty: h.qty,
        note: h.note,
      }))
      .filter((h) => h.target)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    excludes: excludes.map((e) => ({ jobId: e.jobId, jobName: e.jobName })),
    trailerOf: Object.fromEntries(loads.map((l) => [l.toolId, l.trailerId])),
  };
}

/**
 * One rule per (match, key). "none" is the "needs no tools" marker, never a
 * target. A key saved only in the round-3 table (kind ids) still counts, its
 * kinds read as types, until it is saved again.
 */
function groupRules(
  rows: (typeof taskToolNeeds.$inferSelect)[],
  oldRows: (typeof taskToolRules.$inferSelect)[],
  kindType: Map<number, string>,
): StoredRule[] {
  const by = new Map<string, StoredRule>();
  const take = (match: string, key: string, target: string | null, label: string, updatedBy: string, updatedAt: string) => {
    const k = `${match}:${key}`;
    const rule = by.get(k) ?? { match: match as RuleMatch, key, targets: [], label, updatedBy, updatedAt };
    if (target && parseTarget(target)) rule.targets.push(target);
    by.set(k, rule);
  };
  for (const r of rows) take(r.match, r.matchKey, r.target, r.label, r.updatedBy, r.updatedAt);
  const fresh = new Set(by.keys());
  for (const r of oldRows) {
    if (fresh.has(`${r.match}:${r.matchKey}`)) continue;
    take(r.match, r.matchKey, r.kindId === 0 ? null : kindType.get(r.kindId) ?? null, r.label, r.updatedBy, r.updatedAt);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------- tool types

/** Add a tool type the Tools list has none of. Returns its type key. */
export async function addType(name: string, by: string): Promise<string> {
  await ensureDb();
  const key = typeKey(name);
  const existing = (await db.select().from(toolKinds)).find((k) => typeKey(k.name) === key);
  if (!existing) await db.insert(toolKinds).values({ name: name.trim(), updatedBy: by, updatedAt: now() });
  return key;
}

/** Remove an added type. Rules and bookings that name it keep it. */
export async function deleteType(rowId: string): Promise<void> {
  await ensureDb();
  const id = Number(rowId);
  if (Number.isInteger(id)) await db.delete(toolKinds).where(eq(toolKinds.id, id));
}

// --------------------------------------------------------------------- rules

export function isRuleMatch(s: unknown): s is RuleMatch {
  return typeof s === "string" && (RULE_ORDER as readonly string[]).includes(s);
}

/**
 * Set what a rule names, replacing what it named before. An empty list
 * stores "needs no tools" (one "none" row), which still covers the task.
 */
export async function upsertRule(
  rule: { match: RuleMatch; key: string; targets: Target[]; label?: string },
  by: string,
): Promise<void> {
  await ensureDb();
  const matchKey = ruleKey(rule.match, rule.key);
  if (!matchKey) throw new Error("A rule needs a task name, task, task type or phase.");
  const targets = [...new Set(rule.targets.filter((t) => parseTarget(t)))];
  const at = now();
  const label = (rule.label ?? rule.key).trim();
  await deleteRuleRows(rule.match, matchKey);
  await db
    .insert(taskToolNeeds)
    .values((targets.length ? targets : ["none"]).map((target) => ({ match: rule.match, matchKey, target, label, updatedBy: by, updatedAt: at })));
}

async function deleteRuleRows(match: RuleMatch, matchKey: string) {
  await db.delete(taskToolNeeds).where(and(eq(taskToolNeeds.match, match), eq(taskToolNeeds.matchKey, matchKey)));
  await db.delete(taskToolRules).where(and(eq(taskToolRules.match, match), eq(taskToolRules.matchKey, matchKey)));
}

export async function deleteRule(match: RuleMatch, key: string): Promise<void> {
  await ensureDb();
  await deleteRuleRows(match, ruleKey(match, key));
}

// --------------------------------------------------------------------- holds

export async function addHold(h: Omit<ToolHold, "id">, by: string): Promise<string> {
  await ensureDb();
  const [row] = await db
    .insert(toolHolds)
    .values({
      kindId: 0,
      target: h.target,
      jobId: h.jobId,
      jobName: h.jobName,
      startDate: h.startDate,
      endDate: h.endDate,
      qty: Math.max(1, Math.floor(h.qty || 1)),
      note: h.note,
      createdBy: by,
      createdAt: now(),
    })
    .returning({ id: toolHolds.id });
  return String(row.id);
}

export async function deleteHold(id: string): Promise<void> {
  await ensureDb();
  const n = Number(id);
  if (Number.isInteger(n)) await db.delete(toolHolds).where(eq(toolHolds.id, n));
}

// ------------------------------------------------------------------ excludes

export async function setJobExcluded(jobId: string, jobName: string, excluded: boolean, by: string): Promise<void> {
  await ensureDb();
  if (!excluded) {
    await db.delete(toolJobExcludes).where(eq(toolJobExcludes.jobId, jobId));
    return;
  }
  await db
    .insert(toolJobExcludes)
    .values({ jobId, jobName, updatedBy: by, updatedAt: now() })
    .onConflictDoUpdate({ target: toolJobExcludes.jobId, set: { jobName, updatedBy: by, updatedAt: now() } });
}

// ------------------------------------------------------------------ trailers

/** Tool id → the trailer it rides in. */
export async function trailerLoads(): Promise<Record<string, string>> {
  await ensureDb();
  const rows = await db.select().from(toolTrailerItems);
  return Object.fromEntries(rows.map((r) => [r.toolId, r.trailerId]));
}

/** Put a tool in a trailer, or take it out (`trailerId` ""). A trailer never rides in itself. */
export async function setToolTrailer(toolId: string, trailerId: string, by: string): Promise<void> {
  await ensureDb();
  if (!trailerId || trailerId === toolId) {
    await db.delete(toolTrailerItems).where(eq(toolTrailerItems.toolId, toolId));
    return;
  }
  await db
    .insert(toolTrailerItems)
    .values({ toolId, trailerId, updatedBy: by, updatedAt: now() })
    .onConflictDoUpdate({ target: toolTrailerItems.toolId, set: { trailerId, updatedBy: by, updatedAt: now() } });
}

// -------------------------------------------------------------------- supply

/** One row of the Tools sheet, as the tool schedule uses it. */
export interface SheetTool {
  id: string;
  name: string;
  type: string;
  toolGroup: string;
  condition: string;
  /** The raw Location: a Project Database id. */
  location: string;
  locationLabel: string;
}

interface ToolsBootstrap {
  tools?: Record<string, unknown>[];
}

/**
 * The Tools sheet, through the same Apps Script action and cache tag as
 * `/api/tools`, so an edit on the Tools page drops this copy too.
 */
const readSheetTools = unstable_cache(
  async () => {
    const b = await callAppsScriptOrThrow<ToolsBootstrap>({ action: "toolsBootstrap" }, { timeoutMs: 50_000 });
    return (b.tools ?? []).map(
      (t): SheetTool => ({
        id: String(t.id ?? ""),
        name: String(t.name ?? ""),
        type: String(t.type ?? ""),
        toolGroup: String(t.toolGroup ?? ""),
        condition: String(t.condition ?? ""),
        location: String(t.location ?? ""),
        locationLabel: String(t.locationLabel ?? ""),
      }),
    ).filter((t) => t.id);
  },
  ["tool-schedule-sheet-tools"],
  { revalidate: 60, tags: ["tools"] },
);

export function getSheetTools(): Promise<SheetTool[]> {
  return readSheetTools();
}
