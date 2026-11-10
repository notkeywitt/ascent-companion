import { and, eq, inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db, ensureDb } from "@/db";
import { taskCodeRules, toolHolds, toolJobExcludes, toolKindCodes, toolKindMembers, toolKinds } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { normalizeTaskName, RULE_ORDER, type RuleMatch, type TaskCodeRule, type ToolHold, type ToolKind } from "@/lib/toolSchedule";

/**
 * The tool schedule's stored plan (docs/plans/TOOL_SCHEDULE_PLAN.md): tool types
 * and their cost codes, which sheet tool is which type, the task → code rules,
 * holds and left-out jobs. All companion data — nothing here writes to
 * JobTread. The rules that use it are pure, in `toolSchedule.ts`.
 */

export interface StoredKind extends ToolKind {
  notes: string;
}
export interface StoredRule extends TaskCodeRule {
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
  kinds: StoredKind[];
  /** Sheet tool id → tool type id. */
  members: Record<string, string>;
  rules: StoredRule[];
  holds: ToolHold[];
  excludes: ExcludedJob[];
}

const now = () => new Date().toISOString();

export async function loadPlan(): Promise<StoredPlan> {
  await ensureDb();
  const [kinds, codes, members, rules, holds, excludes] = await Promise.all([
    db.select().from(toolKinds),
    db.select().from(toolKindCodes),
    db.select().from(toolKindMembers),
    db.select().from(taskCodeRules),
    db.select().from(toolHolds),
    db.select().from(toolJobExcludes),
  ]);
  return {
    kinds: kinds
      .map((k) => ({
        id: String(k.id),
        name: k.name,
        notes: k.notes,
        costCodeIds: codes.filter((c) => c.kindId === k.id).map((c) => c.costCodeId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    members: Object.fromEntries(members.map((m) => [m.toolId, String(m.kindId)])),
    rules: rules.map((r) => ({
      match: r.match as RuleMatch,
      key: r.matchKey,
      costCodeId: r.costCodeId,
      label: r.label,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    })),
    holds: holds
      .map((h) => ({
        id: String(h.id),
        kindId: String(h.kindId),
        jobId: h.jobId,
        jobName: h.jobName,
        startDate: h.startDate,
        endDate: h.endDate,
        qty: h.qty,
        note: h.note,
      }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    excludes: excludes.map((e) => ({ jobId: e.jobId, jobName: e.jobName })),
  };
}

// ---------------------------------------------------------------- tool types

export async function createKind(name: string, by: string): Promise<string> {
  await ensureDb();
  const [row] = await db
    .insert(toolKinds)
    .values({ name: name.trim(), updatedBy: by, updatedAt: now() })
    .returning({ id: toolKinds.id });
  return String(row.id);
}

export interface KindPatch {
  name?: string;
  notes?: string;
  /** Replaces the tool type's cost codes. */
  costCodeIds?: string[];
  /** Replaces which sheet tools are this type. A tool moves here from any other type. */
  toolIds?: string[];
}

/** Returns false when no tool type has this id. */
export async function updateKind(id: string, patch: KindPatch, by: string): Promise<boolean> {
  await ensureDb();
  const kindId = Number(id);
  if (!Number.isInteger(kindId)) return false;
  const set: Partial<typeof toolKinds.$inferInsert> = { updatedBy: by, updatedAt: now() };
  if (typeof patch.name === "string" && patch.name.trim()) set.name = patch.name.trim();
  if (typeof patch.notes === "string") set.notes = patch.notes;
  const hit = await db.update(toolKinds).set(set).where(eq(toolKinds.id, kindId)).returning({ id: toolKinds.id });
  if (hit.length === 0) return false;
  if (patch.costCodeIds) {
    const ids = [...new Set(patch.costCodeIds.filter(Boolean))];
    await db.delete(toolKindCodes).where(eq(toolKindCodes.kindId, kindId));
    if (ids.length) await db.insert(toolKindCodes).values(ids.map((costCodeId) => ({ kindId, costCodeId })));
  }
  if (patch.toolIds) {
    const ids = [...new Set(patch.toolIds.filter(Boolean))];
    await db.delete(toolKindMembers).where(eq(toolKindMembers.kindId, kindId));
    if (ids.length) {
      await db.delete(toolKindMembers).where(inArray(toolKindMembers.toolId, ids));
      await db.insert(toolKindMembers).values(ids.map((toolId) => ({ toolId, kindId, updatedBy: by, updatedAt: now() })));
    }
  }
  return true;
}

/** Deletes a tool type with its codes, its tool tags and its holds. */
export async function deleteKind(id: string): Promise<void> {
  await ensureDb();
  const kindId = Number(id);
  if (!Number.isInteger(kindId)) return;
  await db.delete(toolKindCodes).where(eq(toolKindCodes.kindId, kindId));
  await db.delete(toolKindMembers).where(eq(toolKindMembers.kindId, kindId));
  await db.delete(toolHolds).where(eq(toolHolds.kindId, kindId));
  await db.delete(toolKinds).where(eq(toolKinds.id, kindId));
}

// --------------------------------------------------------------------- rules

export function isRuleMatch(s: unknown): s is RuleMatch {
  return typeof s === "string" && (RULE_ORDER as readonly string[]).includes(s);
}

/** The key a rule is stored under: names and phases are stored normalized. */
export function storedRuleKey(match: RuleMatch, key: string): string {
  return match === "name" || match === "phase" ? normalizeTaskName(key) : key.trim();
}

export async function upsertRule(
  rule: { match: RuleMatch; key: string; costCodeId: string | null; label?: string },
  by: string,
): Promise<void> {
  await ensureDb();
  const matchKey = storedRuleKey(rule.match, rule.key);
  if (!matchKey) throw new Error("A rule needs a task name, task, task type or phase.");
  const values = {
    match: rule.match,
    matchKey,
    costCodeId: rule.costCodeId || null,
    label: (rule.label ?? rule.key).trim(),
    updatedBy: by,
    updatedAt: now(),
  };
  await db
    .insert(taskCodeRules)
    .values(values)
    .onConflictDoUpdate({
      target: [taskCodeRules.match, taskCodeRules.matchKey],
      set: { costCodeId: values.costCodeId, label: values.label, updatedBy: by, updatedAt: values.updatedAt },
    });
}

export async function deleteRule(match: RuleMatch, key: string): Promise<void> {
  await ensureDb();
  await db
    .delete(taskCodeRules)
    .where(and(eq(taskCodeRules.match, match), eq(taskCodeRules.matchKey, storedRuleKey(match, key))));
}

// --------------------------------------------------------------------- holds

export async function addHold(h: Omit<ToolHold, "id">, by: string): Promise<string> {
  await ensureDb();
  const [row] = await db
    .insert(toolHolds)
    .values({
      kindId: Number(h.kindId),
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

// -------------------------------------------------------------------- supply

/** One row of the Tools sheet, as the tool schedule uses it. */
export interface SheetTool {
  id: string;
  name: string;
  type: string;
  toolGroup: string;
  condition: string;
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
