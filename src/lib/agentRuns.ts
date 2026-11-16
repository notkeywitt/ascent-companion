/**
 * AI scripts, server side: settings, runs, steps and Macs (/ai-scripts).
 * The script list is src/lib/agentScripts.ts; the Mac side is
 * scripts/agent-progress/agent-run.mjs through /api/invoice-review/agent/progress.
 *
 * A RUN'S LIFE
 *   check  — every run.sh calls it on every tick: it records the Mac as seen,
 *            says whether the script is paused, and hands out a pending
 *            "Run now" (once: the first Mac to ask takes it).
 *   start  — agent-run.mjs is about to start Claude Code. Returns the run id
 *            and the settings to run with (model, extra instructions, max turns).
 *   events — every few seconds, the steps read off Claude Code's stream-json
 *            output. The answer says whether someone pressed Stop.
 *   end    — the exit, the cost and the tokens Claude Code reported. The cost
 *            also goes into ai_usage, so AI Cost counts the Macs' runs.
 *
 * Nothing here calls Claude or touches JobTread.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";

import { db, ensureDb, rawDb } from "@/db";
import { agentMachines, agentRunEvents, agentRuns, agentScriptSettings, type AgentRunRow } from "@/db/schema";
import {
  AGENT_SCRIPTS,
  isModel,
  scriptById,
  type AgentModel,
  type ScriptSettings,
} from "@/lib/agentScripts";

const now = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A run with no report for this long died with its Mac. */
const DEAD_RUN_MS = 3 * 60 * 60 * 1000;
/** A "Run now" no Mac picked up in this long is dropped. */
const RUN_REQUEST_TTL_MS = 60 * 60 * 1000;
/** Steps older than this are deleted. */
const EVENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type RunStatus = "running" | "done" | "error" | "stopped";

// ── Settings ────────────────────────────────────────────────────────────────

export interface ScriptState extends ScriptSettings {
  runRequestedAt: string;
  runRequestedBy: string;
  runArg: string;
  updatedBy: string;
  updatedAt: string;
}

async function settingsRow(scriptId: string) {
  const [row] = await db.select().from(agentScriptSettings).where(eq(agentScriptSettings.scriptId, scriptId));
  return row ?? null;
}

function stateOf(scriptId: string, row: typeof agentScriptSettings.$inferSelect | null): ScriptState {
  const def = scriptById(scriptId);
  return {
    model: isModel(row?.model) ? (row!.model as AgentModel) : (def?.defaultModel ?? "sonnet"),
    paused: !!row?.paused,
    extraPrompt: row?.extraPrompt ?? "",
    maxTurns: row?.maxTurns ?? 0,
    runRequestedAt: row?.runRequestedAt && row.runRequestedAt > ago(RUN_REQUEST_TTL_MS) ? row.runRequestedAt : "",
    runRequestedBy: row?.runRequestedBy ?? "",
    runArg: row?.runArg ?? "",
    updatedBy: row?.updatedBy ?? "",
    updatedAt: row?.updatedAt ?? "",
  };
}

async function upsertSettings(scriptId: string, set: Partial<typeof agentScriptSettings.$inferInsert>): Promise<void> {
  await db
    .insert(agentScriptSettings)
    .values({ scriptId, ...set })
    .onConflictDoUpdate({ target: agentScriptSettings.scriptId, set });
}

export async function saveSettings(scriptId: string, change: Partial<ScriptSettings>, by: string): Promise<ScriptState> {
  await ensureDb();
  const set: Partial<typeof agentScriptSettings.$inferInsert> = { updatedBy: by, updatedAt: now() };
  if (change.model !== undefined) set.model = change.model;
  if (change.paused !== undefined) set.paused = change.paused ? 1 : 0;
  if (change.extraPrompt !== undefined) set.extraPrompt = change.extraPrompt;
  if (change.maxTurns !== undefined) set.maxTurns = change.maxTurns;
  await upsertSettings(scriptId, set);
  return stateOf(scriptId, await settingsRow(scriptId));
}

export async function requestRunNow(scriptId: string, arg: string, by: string): Promise<void> {
  await ensureDb();
  await upsertSettings(scriptId, { runRequestedAt: now(), runRequestedBy: by, runArg: arg });
}

export async function cancelRunNow(scriptId: string): Promise<void> {
  await ensureDb();
  await upsertSettings(scriptId, { runRequestedAt: "", runRequestedBy: "", runArg: "" });
}

// ── The Mac's side ──────────────────────────────────────────────────────────

async function seeMachine(machine: string, scriptId: string): Promise<void> {
  const t = now();
  const [row] = await db.select().from(agentMachines).where(eq(agentMachines.name, machine));
  let scripts: Record<string, string> = {};
  try {
    scripts = JSON.parse(row?.scripts || "{}");
  } catch {
    scripts = {};
  }
  scripts[scriptId] = t;
  const json = JSON.stringify(scripts);
  await db
    .insert(agentMachines)
    .values({ name: machine, lastSeenAt: t, scripts: json })
    .onConflictDoUpdate({ target: agentMachines.name, set: { lastSeenAt: t, scripts: json } });
}

/**
 * The tick. "paused", "now" (a Run now this Mac just took, with its value)
 * or "idle" (do the script's own due check).
 */
export async function check(scriptId: string, machine: string): Promise<{ state: "paused" | "now" | "idle"; arg: string }> {
  await ensureDb();
  await seeMachine(machine, scriptId);
  const s = stateOf(scriptId, await settingsRow(scriptId));
  if (s.paused) return { state: "paused", arg: "" };
  if (!s.runRequestedAt) return { state: "idle", arg: "" };
  // The claim: only one Mac's update still finds the request.
  const taken = await db
    .update(agentScriptSettings)
    .set({ runRequestedAt: "", runRequestedBy: "", runArg: "" })
    .where(and(eq(agentScriptSettings.scriptId, scriptId), eq(agentScriptSettings.runRequestedAt, s.runRequestedAt)))
    .returning({ id: agentScriptSettings.scriptId });
  return taken.length ? { state: "now", arg: s.runArg } : { state: "idle", arg: "" };
}

export interface StartAnswer {
  runId: string;
  model: AgentModel;
  extraPrompt: string;
  maxTurns: number;
}

export async function startRun(scriptId: string, machine: string, title: string): Promise<StartAnswer> {
  await ensureDb();
  await seeMachine(machine, scriptId);
  await expireDead();
  const s = stateOf(scriptId, await settingsRow(scriptId));
  const id = `run_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const t = now();
  await db.insert(agentRuns).values({
    id,
    scriptId,
    machine,
    model: s.model,
    title: title.slice(0, 200) || (scriptById(scriptId)?.name ?? scriptId),
    status: "running",
    startedAt: t,
    lastEventAt: t,
    lastStep: "Starting Claude Code",
  });
  return { runId: id, model: s.model, extraPrompt: s.extraPrompt, maxTurns: s.maxTurns };
}

export interface EventIn {
  at: string;
  kind: "step" | "note" | "error";
  text: string;
}

/** Store a batch of steps. Answers whether someone pressed Stop. */
export async function addEvents(runId: string, events: EventIn[]): Promise<{ stop: boolean }> {
  await ensureDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return { stop: false };
  const clean = events
    .slice(0, 200)
    .map((e) => ({
      runId,
      at: typeof e.at === "string" && e.at ? e.at.slice(0, 30) : now(),
      kind: e.kind === "note" || e.kind === "error" ? e.kind : "step",
      text: String(e.text ?? "").slice(0, 500),
    }))
    .filter((e) => e.text);
  if (clean.length) {
    await db.insert(agentRunEvents).values(clean);
    const lastStep = [...clean].reverse().find((e) => e.kind === "step") ?? clean[clean.length - 1];
    await db
      .update(agentRuns)
      .set({ lastEventAt: now(), lastStep: lastStep.text.slice(0, 300), steps: run.steps + clean.filter((e) => e.kind === "step").length })
      .where(eq(agentRuns.id, runId));
  } else {
    await db.update(agentRuns).set({ lastEventAt: now() }).where(eq(agentRuns.id, runId));
  }
  return { stop: !!run.stopRequestedAt };
}

export interface EndIn {
  status: RunStatus;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  result: string;
}

export async function endRun(runId: string, end: EndIn): Promise<void> {
  await ensureDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return;
  const status: RunStatus = ["done", "error", "stopped"].includes(end.status) ? end.status : "error";
  const cost = typeof end.costUsd === "number" && Number.isFinite(end.costUsd) ? end.costUsd : null;
  await db
    .update(agentRuns)
    .set({
      status,
      endedAt: now(),
      costUsd: cost,
      inputTokens: Math.max(0, Math.round(end.inputTokens || 0)),
      outputTokens: Math.max(0, Math.round(end.outputTokens || 0)),
      result: String(end.result ?? "").slice(0, 2000),
    })
    .where(eq(agentRuns.id, runId));
  // AI Cost counts the Macs' runs too. Claude Code reports its own price.
  if (cost != null || end.inputTokens || end.outputTokens) {
    try {
      await rawDb().execute({
        sql: `INSERT INTO ai_usage (at, feature, model, ref, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          now(),
          `mac.${run.scriptId}`,
          run.model,
          run.ref || run.id,
          Math.round(end.inputTokens || 0),
          Math.round(end.outputTokens || 0),
          Math.round(end.cacheWriteTokens || 0),
          Math.round(end.cacheReadTokens || 0),
          cost,
        ],
      });
    } catch (e) {
      console.error(`[agent-runs] could not record cost: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/** Lead research names its run once it has claimed a lead (lib/leadResearch.ts). */
export async function linkRun(scriptId: string, machine: string, ref: string, title: string): Promise<void> {
  await ensureDb();
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.scriptId, scriptId), eq(agentRuns.machine, machine), eq(agentRuns.status, "running")))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  if (run) await db.update(agentRuns).set({ ref, title: title.slice(0, 200) }).where(eq(agentRuns.id, run.id));
}

async function expireDead(): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status: "error", endedAt: now(), result: "The Mac stopped reporting. It may have slept or lost its connection." })
    .where(and(eq(agentRuns.status, "running"), lt(agentRuns.lastEventAt, ago(DEAD_RUN_MS))));
  await db.delete(agentRunEvents).where(lt(agentRunEvents.at, ago(EVENT_KEEP_MS)));
}

// ── The page's side ─────────────────────────────────────────────────────────

export async function requestStop(runId: string, by: string): Promise<boolean> {
  await ensureDb();
  const r = await db
    .update(agentRuns)
    .set({ stopRequestedAt: now(), stopRequestedBy: by })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")))
    .returning({ id: agentRuns.id });
  return r.length > 0;
}

/** Stop whatever run is working on a feature's record (a lead research id). */
export async function requestStopByRef(ref: string, by: string): Promise<void> {
  await ensureDb();
  await db
    .update(agentRuns)
    .set({ stopRequestedAt: now(), stopRequestedBy: by })
    .where(and(eq(agentRuns.ref, ref), eq(agentRuns.status, "running")));
}

export interface RunView {
  id: string;
  scriptId: string;
  machine: string;
  model: string;
  title: string;
  ref: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  lastStep: string;
  steps: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  result: string;
  stopRequested: boolean;
}

function view(r: AgentRunRow): RunView {
  return {
    id: r.id,
    scriptId: r.scriptId,
    machine: r.machine,
    model: r.model,
    title: r.title,
    ref: r.ref,
    status: r.status as RunStatus,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    lastEventAt: r.lastEventAt,
    lastStep: r.lastStep,
    steps: r.steps,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    result: r.result,
    stopRequested: !!r.stopRequestedAt,
  };
}

export interface EventView {
  id: number;
  at: string;
  kind: string;
  text: string;
}

async function eventsOf(runId: string, limit: number): Promise<EventView[]> {
  const rows = await db
    .select()
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, runId))
    .orderBy(desc(agentRunEvents.id))
    .limit(limit);
  return rows.reverse().map((e) => ({ id: e.id, at: e.at, kind: e.kind, text: e.text }));
}

export interface Dashboard {
  scripts: { id: string; settings: ScriptState; lastRun: RunView | null; installedOn: { machine: string; lastCheckAt: string }[] }[];
  running: (RunView & { events: EventView[] })[];
  recent: RunView[];
  machines: { name: string; lastSeenAt: string; scripts: Record<string, string>; busy: string }[];
}

export async function dashboard(): Promise<Dashboard> {
  await ensureDb();
  await expireDead();
  const [settings, running, recent, machines] = await Promise.all([
    db.select().from(agentScriptSettings),
    db.select().from(agentRuns).where(eq(agentRuns.status, "running")).orderBy(desc(agentRuns.startedAt)),
    db.select().from(agentRuns).where(ne(agentRuns.status, "running")).orderBy(desc(agentRuns.startedAt)).limit(30),
    db.select().from(agentMachines).orderBy(desc(agentMachines.lastSeenAt)),
  ]);
  const machineScripts = machines.map((m) => {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(m.scripts || "{}");
    } catch {
      scripts = {};
    }
    return { name: m.name, lastSeenAt: m.lastSeenAt, scripts };
  });
  const lastByScript = new Map<string, AgentRunRow>();
  for (const r of [...running, ...recent]) if (!lastByScript.has(r.scriptId)) lastByScript.set(r.scriptId, r);
  return {
    scripts: AGENT_SCRIPTS.map((s) => ({
      id: s.id,
      settings: stateOf(s.id, settings.find((x) => x.scriptId === s.id) ?? null),
      lastRun: lastByScript.has(s.id) ? view(lastByScript.get(s.id)!) : null,
      installedOn: machineScripts
        .filter((m) => m.scripts[s.id])
        .map((m) => ({ machine: m.name, lastCheckAt: m.scripts[s.id] })),
    })),
    running: await Promise.all(running.map(async (r) => ({ ...view(r), events: await eventsOf(r.id, 40) }))),
    recent: recent.map(view),
    machines: machineScripts.map((m) => ({ ...m, busy: running.find((r) => r.machine === m.name)?.title ?? "" })),
  };
}

/** One run with its steps (the page's run detail). */
export async function runDetail(runId: string): Promise<(RunView & { events: EventView[] }) | null> {
  await ensureDb();
  const [r] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  return r ? { ...view(r), events: await eventsOf(runId, 500) } : null;
}

/** The live run behind each feature record, for that feature's own page. */
export async function liveByRef(refs: string[]): Promise<Record<string, { lastStep: string; lastEventAt: string; steps: number; runId: string }>> {
  await ensureDb();
  if (!refs.length) return {};
  const rows = await db
    .select()
    .from(agentRuns)
    .where(and(inArray(agentRuns.ref, refs), eq(agentRuns.status, "running")));
  return Object.fromEntries(rows.map((r) => [r.ref, { lastStep: r.lastStep, lastEventAt: r.lastEventAt, steps: r.steps, runId: r.id }]));
}
