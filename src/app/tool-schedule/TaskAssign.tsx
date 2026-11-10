"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input } from "@/components/ui";
import { matchesAllWords } from "@/lib/searchWords";
import type { RuleMatch, Target } from "@/lib/toolSchedule";
import { findShortages, targetLabel, type PickGroup, type PickTool, type PickType, type Shortage } from "./ToolPickers";

/**
 * Connecting tools to tasks, shared by the tool schedule's editor and the
 * Tools page's edit dialog: the rules read once (`useTaskRules`), and a
 * tool's (or type's, or group's) assigned tasks with "Assign to tasks"
 * (`AssignedTasks`). Every change is saved to `/api/tool-schedule/rules` on
 * the tick.
 */

export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}

export interface Rule {
  match: RuleMatch;
  key: string;
  targets: Target[];
  label: string;
  updatedBy: string;
  updatedAt: string;
}
export interface PhaseName {
  key: string;
  name: string;
  taskCount: number;
  via: RuleMatch | null;
}
export interface PhaseRow {
  key: string;
  name: string;
  taskCount: number;
  jobNames: string[];
  names: PhaseName[];
}
export interface Unresolved {
  key: string;
  name: string;
  phase: string;
  jobNames: string[];
  taskIds: string[];
  suggestions: Target[];
}
export interface EditorData {
  rules: Rule[];
  tools: PickTool[];
  types: PickType[];
  groups: PickGroup[];
  toolsError?: string;
  phases: PhaseRow[];
  taskTypes: { id: string; name: string; taskCount: number }[];
  unresolved: Unresolved[];
}

export const MATCH_LABEL: Record<RuleMatch, string> = { task: "One task", name: "Task name", taskType: "Task type", phase: "Phase" };

/** Everything the connecting views read, loaded once and shared. */
export interface Editing {
  data: EditorData;
  rulesBy: Map<string, Rule>;
  label: (t: Target) => string;
  names: (targets: Target[]) => string;
  busyKey: string;
  /** Replace what a rule names ([] = needs no tools); asks about requisitions for a newly named type. */
  saveRule: (match: RuleMatch, key: string, label: string, targets: Target[]) => Promise<void>;
  clearRule: (match: RuleMatch, key: string) => Promise<void>;
  addType: (name: string) => Promise<void>;
}

/**
 * Load the rules, phases and catalogue (`enabled` false skips the read, for a
 * person who may not edit them). `prompt` holds the requisition offer after a
 * newly named type turns out short.
 */
export function useTaskRules(enabled = true) {
  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [prompt, setPrompt] = useState<Shortage[] | null>(null);

  const load = useCallback(() => {
    if (!enabled) return;
    call<EditorData>("/api/tool-schedule/rules")
      .then((d) => setData({ ...d, groups: d.groups ?? [] }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [enabled]);
  useEffect(load, [load]);

  const rulesBy = useMemo(() => new Map((data?.rules ?? []).map((r) => [`${r.match}:${r.key}`, r])), [data]);

  const saveRule = useCallback(
    async (match: RuleMatch, key: string, label: string, targets: Target[]) => {
      const before = rulesBy.get(`${match}:${key}`)?.targets ?? [];
      setBusyKey(`${match}:${key}`);
      setError("");
      try {
        await call("/api/tool-schedule/rules", { method: "PUT", body: JSON.stringify({ match, key, label, targets }) });
        load();
        const short = await findShortages(match, key, targets.filter((t) => !before.includes(t)));
        if (short.length) setPrompt(short);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey("");
      }
    },
    [rulesBy, load],
  );
  const clearRule = useCallback(
    async (match: RuleMatch, key: string) => {
      setBusyKey(`${match}:${key}`);
      setError("");
      try {
        await call(`/api/tool-schedule/rules?match=${match}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey("");
      }
    },
    [load],
  );
  const addType = useCallback(
    async (name: string) => {
      await call("/api/tool-schedule/catalog", { method: "POST", body: JSON.stringify({ name }) });
      load();
    },
    [load],
  );

  const editing: Editing | null = data
    ? {
        data,
        rulesBy,
        label: (t) => targetLabel(t, data.tools, data.types, data.groups),
        names: (ts) => (ts.length ? ts.map((t) => targetLabel(t, data.tools, data.types, data.groups)).join(", ") : "Needs no tools"),
        busyKey,
        saveRule,
        clearRule,
        addType,
      }
    : null;
  return { editing, error, setError, load, prompt, clearPrompt: () => setPrompt(null) };
}

interface TaskOption {
  match: RuleMatch;
  key: string;
  label: string;
  hint: string;
}

/** Every phase, task name and task type a target can be assigned to: those scheduled, and any already ruled. */
function taskOptions(e: Editing): TaskOption[] {
  const out = new Map<string, TaskOption>();
  const add = (o: TaskOption) => !out.has(`${o.match}:${o.key}`) && out.set(`${o.match}:${o.key}`, o);
  for (const p of e.data.phases) add({ match: "phase", key: p.key, label: p.name, hint: `${p.taskCount} ${p.taskCount === 1 ? "task" : "tasks"}` });
  for (const p of e.data.phases) for (const n of p.names) add({ match: "name", key: n.key, label: n.name, hint: p.name });
  for (const u of e.data.unresolved) add({ match: "name", key: u.key, label: u.name, hint: u.phase || u.jobNames.join(", ") });
  for (const t of e.data.taskTypes) add({ match: "taskType", key: t.id, label: t.name, hint: `${t.taskCount} ${t.taskCount === 1 ? "task" : "tasks"}` });
  for (const r of e.data.rules) add({ match: r.match, key: r.key, label: r.label || r.key, hint: "Not on the schedule now" });
  return [...out.values()];
}

/** Assign one target to tasks, or take it off them: a searchable checklist, saved on each tick. */
function AssignPicker({ e, target }: { e: Editing; target: Target }) {
  const [q, setQ] = useState("");
  const options = taskOptions(e).filter((o) => matchesAllWords(`${o.label} ${o.hint} ${MATCH_LABEL[o.match]}`, q));
  const groups: { title: string; match: RuleMatch }[] = [
    { title: "Phases", match: "phase" },
    { title: "Task names", match: "name" },
    { title: "Task types", match: "taskType" },
    { title: "Single tasks", match: "task" },
  ];
  async function toggle(o: TaskOption, on: boolean) {
    const rule = e.rulesBy.get(`${o.match}:${o.key}`);
    const now = rule?.targets ?? [];
    if (on) {
      const rest = now.filter((t) => t !== target);
      if (rest.length) await e.saveRule(o.match, o.key, o.label, rest);
      else await e.clearRule(o.match, o.key);
    } else await e.saveRule(o.match, o.key, o.label, [...now, target]);
  }
  return (
    <div className="grid gap-2 rounded-lg border border-line p-2">
      <Input id={`assign-${target}`} placeholder="Search phases and task names…" aria-label="Search phases and task names" value={q} onChange={(ev) => setQ(ev.target.value)} />
      <div className="grid max-h-72 gap-3 overflow-y-auto">
        {groups.map((g) => {
          const list = options.filter((o) => o.match === g.match).sort((a, b) => a.label.localeCompare(b.label));
          if (!list.length) return null;
          return (
            <div key={g.match}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{g.title}</div>
              {list.map((o) => {
                const on = !!e.rulesBy.get(`${o.match}:${o.key}`)?.targets.includes(target);
                return (
                  <div key={o.key} className="flex min-h-9 items-center">
                    <Checkbox
                      checked={on}
                      disabled={e.busyKey === `${o.match}:${o.key}`}
                      onChange={() => void toggle(o, on)}
                      label={
                        <span>
                          {o.label} <span className="text-[12px] text-neutral-500">· {o.hint}</span>
                        </span>
                      }
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {options.length === 0 && <p className="text-sm text-neutral-500">Nothing matches.</p>}
      </div>
    </div>
  );
}

/** The tasks a target is assigned to, each removable, and "Assign to tasks". */
export function AssignedTasks({ e, target, extra }: { e: Editing; target: Target; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const assigned = e.data.rules.filter((r) => r.targets.includes(target));
  async function unassign(r: Rule) {
    const rest = r.targets.filter((t) => t !== target);
    if (rest.length) await e.saveRule(r.match, r.key, r.label, rest);
    else await e.clearRule(r.match, r.key);
  }
  return (
    <div className="grid gap-2">
      {assigned.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {assigned.map((r) => (
            <span key={`${r.match}:${r.key}`} className="inline-flex items-center gap-1 rounded-full border border-line-strong py-0.5 pl-2.5 text-[12px]">
              <span className="text-neutral-500">{MATCH_LABEL[r.match]}:</span> {r.label || r.key}
              <button
                type="button"
                aria-label={`Take it off ${r.label || r.key}`}
                disabled={e.busyKey === `${r.match}:${r.key}`}
                onClick={() => void unassign(r)}
                className="min-h-7 min-w-7 text-neutral-500"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="xs" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Done" : "Assign to tasks"}
        </Button>
        {extra}
      </div>
      {open && <AssignPicker e={e} target={target} />}
    </div>
  );
}
