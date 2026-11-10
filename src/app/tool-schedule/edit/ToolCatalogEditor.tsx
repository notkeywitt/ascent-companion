"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  btn,
  Button,
  Checkbox,
  EmptyState,
  Input,
  ListCard,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
  tableCls,
  Tabs,
} from "@/components/ui";
import { matchesAllWords } from "@/lib/searchWords";
import type { RuleMatch, Target, ToolHold } from "@/lib/toolSchedule";
import {
  sortCatalogTools,
  sortRules,
  sortUnresolved,
  type RuleSortKey,
  type SortDir,
  type ToolSortKey,
  type UnresolvedSortKey,
} from "@/lib/toolScheduleView";
import { BookingForm } from "../BookingForm";
import { findShortages, RequisitionPrompt, TargetPicker, targetLabel, type PickTool, type PickType, type Shortage } from "../ToolPickers";

/**
 * The tool schedule's editor (docs/plans/TOOL_SCHEDULE_PLAN.md), for the office.
 * Two ways to connect tools and tasks, over the same rules:
 *   Tools    — the tool tracker's list (and each tool type): which tasks each
 *              one is assigned to, and "Assign to tasks".
 *   Tasks    — the phases, task names and task types the schedule uses: what
 *              each one needs, and "Add tool". A task needs its phase's tools
 *              plus its own.
 *   Bookings — book a tool by hand, for a job or a place, with no task.
 *   Jobs     — leave a job's schedule out (a PreCon copy of another Gantt).
 * Naming a tool type no tool of is free for offers a requisition. Companion
 * data only, except a tool's type, which is saved to the Tools list.
 */

export type EditorTab = "tools" | "tasks" | "bookings" | "jobs";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}

interface Rule {
  match: RuleMatch;
  key: string;
  targets: Target[];
  label: string;
  updatedBy: string;
  updatedAt: string;
}
interface PhaseName {
  key: string;
  name: string;
  taskCount: number;
  via: RuleMatch | null;
}
interface PhaseRow {
  key: string;
  name: string;
  taskCount: number;
  jobNames: string[];
  names: PhaseName[];
}
interface Unresolved {
  key: string;
  name: string;
  phase: string;
  jobNames: string[];
  taskIds: string[];
  suggestions: Target[];
}
interface EditorData {
  rules: Rule[];
  tools: PickTool[];
  types: PickType[];
  toolsError?: string;
  phases: PhaseRow[];
  taskTypes: { id: string; name: string; taskCount: number }[];
  unresolved: Unresolved[];
}

const MATCH_LABEL: Record<RuleMatch, string> = { task: "One task", name: "Task name", taskType: "Task type", phase: "Phase" };

interface Sort<K extends string> {
  key: K;
  dir: SortDir;
}

/** A list's sort: which field, and which way. Ties always read A–Z. */
function SortBar<K extends string>({
  label,
  keys,
  sort,
  onChange,
}: {
  label: string;
  keys: readonly { value: K; label: string }[];
  sort: Sort<K>;
  onChange: (s: Sort<K>) => void;
}) {
  const asc = sort.dir === "asc";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Sort</span>
      <Select aria-label={label} value={sort.key} onChange={(e) => onChange({ ...sort, key: e.target.value as K })} className="!w-auto max-w-full text-xs">
        {keys.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </Select>
      <Button variant="secondary" size="xs" aria-label={`${label}: ${asc ? "ascending" : "descending"}. Switch order`} onClick={() => onChange({ ...sort, dir: asc ? "desc" : "asc" })}>
        <span aria-hidden>{asc ? "▲" : "▼"}</span>
      </Button>
    </div>
  );
}

/** A table header that sorts its column. */
function SortTh<K extends string>({ label, k, sort, onSort }: { label: string; k: K; sort: Sort<K>; onSort: (k: K) => void }) {
  const on = sort.key === k;
  return (
    <th className={tableCls.th} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex min-h-8 items-center gap-1 uppercase">
        {label}
        <span aria-hidden className={on ? "" : "text-neutral-400"}>
          {on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/** Everything both connecting views read, loaded once and shared. */
interface Editing {
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

export function ToolCatalogEditor({ initialTab }: { initialTab: EditorTab }) {
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [prompt, setPrompt] = useState<Shortage[] | null>(null);

  const load = useCallback(() => {
    call<EditorData>("/api/tool-schedule/rules")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const rulesBy = useMemo(() => new Map((data?.rules ?? []).map((r) => [`${r.match}:${r.key}`, r])), [data]);

  async function saveRule(match: RuleMatch, key: string, label: string, targets: Target[]) {
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
  }
  async function clearRule(match: RuleMatch, key: string) {
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
  }
  async function addType(name: string) {
    await call("/api/tool-schedule/catalog", { method: "POST", body: JSON.stringify({ name }) });
    load();
  }

  const items: { key: EditorTab; label: string }[] = [
    { key: "tools", label: "Tools" },
    { key: "tasks", label: data?.unresolved.length ? `Tasks (${data.unresolved.length})` : "Tasks" },
    { key: "bookings", label: "Bookings" },
    { key: "jobs", label: "Jobs" },
  ];
  const editing: Editing | null = data
    ? {
        data,
        rulesBy,
        label: (t) => targetLabel(t, data.tools, data.types),
        names: (ts) => (ts.length ? ts.map((t) => targetLabel(t, data.tools, data.types)).join(", ") : "Needs no tools"),
        busyKey,
        saveRule,
        clearRule,
        addType,
      }
    : null;

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-4xl">
      <PageHeader
        title="Edit Tool Schedule"
        actions={
          <Link href="/tool-schedule" className={btn("secondary", "sm")}>
            ← Tool Schedule
          </Link>
        }
      />
      <Tabs label="Section" items={items.map((t) => ({ key: t.key, label: t.label, active: tab === t.key, onClick: () => setTab(t.key) }))} />
      {error && <Banner tone="error" className="mb-4">{error}</Banner>}
      {editing?.data.toolsError && <Banner tone="warning" className="mb-4">The Tools list could not be read: {editing.data.toolsError}</Banner>}
      {tab === "jobs" ? (
        <Jobs />
      ) : !editing ? (
        error ? null : <Loading label="Reading the tool tracker and the JobTread schedules…" />
      ) : tab === "tools" ? (
        <ToolsView e={editing} reload={load} />
      ) : tab === "tasks" ? (
        <TasksView e={editing} />
      ) : (
        <Bookings />
      )}
      {prompt && <RequisitionPrompt shortages={prompt} onClose={() => setPrompt(null)} />}
    </main>
  );
}

/* ------------------------------------------------------------------- Tools */

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

/** One tool or tool type: what it is, the tasks it is assigned to, and "Assign to tasks". */
function TargetRow({
  e,
  target,
  title,
  meta,
  extra,
  danger = false,
}: {
  e: Editing;
  target: Target;
  title: React.ReactNode;
  meta: React.ReactNode[];
  extra?: React.ReactNode;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const assigned = e.data.rules.filter((r) => r.targets.includes(target));
  async function unassign(r: Rule) {
    const rest = r.targets.filter((t) => t !== target);
    if (rest.length) await e.saveRule(r.match, r.key, r.label, rest);
    else await e.clearRule(r.match, r.key);
  }
  return (
    <div className="grid gap-2 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`text-sm font-semibold ${danger ? "text-danger" : ""}`}>{title}</span>
          <MetaLine items={meta} />
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-neutral-500">
          {assigned.length} {assigned.length === 1 ? "task" : "tasks"}
        </span>
      </div>
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

/** Change a tool's ToolType — saved to the Tools list, the same write the Tools page makes. */
function TypeEditor({ tool, types, onSaved }: { tool: PickTool; types: PickType[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(tool.type);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open)
    return (
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        {tool.type ? "Change type" : "Set its type"}
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setBusy(true);
        setError("");
        try {
          await call("/api/tools", { method: "PATCH", body: JSON.stringify({ toolId: tool.id, fields: { type: value.trim() } }) });
          setOpen(false);
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input id={`type-${tool.id}`} list={`types-${tool.id}`} value={value} onChange={(ev) => setValue(ev.target.value)} aria-label="Tool type" className="!w-48" />
      <datalist id={`types-${tool.id}`}>
        {types.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
      <Button type="submit" size="xs" disabled={busy || value.trim() === tool.type}>
        Save to Tools list
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </Button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </form>
  );
}

function ToolsView({ e, reload }: { e: Editing; reload: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort<ToolSortKey>>({ key: "type", dir: "asc" });
  const [newType, setNewType] = useState("");
  const [busy, setBusy] = useState(false);
  const uses = (target: Target) => e.data.rules.filter((r) => r.targets.includes(target)).length;
  const tools = sortCatalogTools(
    e.data.tools.filter((t) => matchesAllWords(`${t.name} ${t.type} ${t.at} ${t.condition}`, q)),
    sort.key,
    sort.dir,
    (id) => uses(`tool:${id}`),
  );
  const types = e.data.types.filter((t) => matchesAllWords(`any ${t.name}`, q));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input id="catalog-search" placeholder="Search tools and types…" aria-label="Search tools and types" value={q} onChange={(ev) => setQ(ev.target.value)} className="sm:!w-72" />
        <SortBar
          label="Sort tools"
          sort={sort}
          onChange={setSort}
          keys={[
            { value: "type", label: "Type" },
            { value: "name", label: "Name" },
            { value: "location", label: "Location" },
            { value: "tasks", label: "Tasks" },
          ]}
        />
      </div>

      <section>
        <SectionHeading>Tool types — any one will do</SectionHeading>
        {types.length === 0 ? (
          <EmptyState>No tool type matches.</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {types.map((t) => (
              <TargetRow
                key={t.id}
                e={e}
                target={`type:${t.id}`}
                title={`Any ${t.name}`}
                danger={t.owned === 0}
                meta={[
                  t.owned ? `${t.owned} usable` : "None owned",
                  t.total > t.owned && `${t.total} in the Tools list`,
                  t.addedRowId && t.total === 0 && "Added by hand",
                ]}
                extra={
                  t.addedRowId && t.total === 0 ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={async () => {
                        await call(`/api/tool-schedule/catalog?rowId=${encodeURIComponent(t.addedRowId!)}`, { method: "DELETE" });
                        reload();
                      }}
                    >
                      Remove type
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ListCard>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!newType.trim()) return;
            setBusy(true);
            try {
              await e.addType(newType.trim());
              setNewType("");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input id="new-type" placeholder="A tool type you don't own, e.g. Scissor lift" value={newType} onChange={(ev) => setNewType(ev.target.value)} aria-label="New tool type" />
          <Button type="submit" variant="secondary" disabled={busy || !newType.trim()} className="shrink-0">
            Add type
          </Button>
        </form>
      </section>

      <section>
        <SectionHeading>Tools in the tool tracker ({e.data.tools.length})</SectionHeading>
        {tools.length === 0 ? (
          <EmptyState>{e.data.tools.length ? "No tool matches." : "The Tools list is empty."}</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {tools.map((t) => (
              <TargetRow
                key={t.id}
                e={e}
                target={`tool:${t.id}`}
                title={t.name}
                danger={!t.usable}
                meta={[t.type || "No type", t.condition, t.usable ? t.at : "Not usable"]}
                extra={<TypeEditor tool={t} types={e.data.types} onSaved={reload} />}
              />
            ))}
          </ListCard>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- Tasks */

/**
 * What one phase, task name or task type needs: chips, "Add tool", then Save.
 * "Needs no tools" covers it with nothing (and drops what its phase would
 * add); Clear removes the rule.
 */
function NeedsEditor({ e, match, k, label, suggestions = [] }: { e: Editing; match: RuleMatch; k: string; label: string; suggestions?: Target[] }) {
  const rule = e.rulesBy.get(`${match}:${k}`);
  const saved = rule ? rule.targets : null;
  const [draft, setDraft] = useState<Target[]>(saved ?? suggestions);
  useEffect(() => setDraft(saved ?? suggestions), [saved?.join(","), suggestions.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = saved === null ? draft.length > 0 : draft.length !== saved.length || draft.some((t) => !saved.includes(t));
  const busy = e.busyKey === `${match}:${k}`;
  const suggested = saved === null && draft.length > 0 && draft.every((t) => suggestions.includes(t)) && draft.length === suggestions.length;
  return (
    <div className="grid gap-2">
      {draft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent/10 py-0.5 pl-2.5 text-[12px] font-medium">
              {e.label(t)}
              <button type="button" aria-label={`Remove ${e.label(t)}`} onClick={() => setDraft(draft.filter((x) => x !== t))} className="min-h-7 min-w-7 text-neutral-500">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <TargetPicker tools={e.data.tools} types={e.data.types} exclude={draft} onPick={(t) => setDraft([...draft, t])} onAddType={e.addType} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={busy || !changed || draft.length === 0} onClick={() => void e.saveRule(match, k, label, draft)}>
          Save
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || (saved !== null && saved.length === 0)} onClick={() => void e.saveRule(match, k, label, [])}>
          Needs no tools
        </Button>
        {saved !== null && (
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => void e.clearRule(match, k)}>
            Clear
          </Button>
        )}
        {suggested && <span className="text-[11px] text-neutral-500">Suggested from similar tasks</span>}
        {saved !== null && saved.length === 0 && <span className="text-[11px] text-neutral-500">Needs no tools</span>}
      </div>
    </div>
  );
}

function TasksView({ e }: { e: Editing }) {
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [unSort, setUnSort] = useState<Sort<UnresolvedSortKey>>({ key: "tasks", dir: "desc" });
  const [ruleSort, setRuleSort] = useState<Sort<RuleSortKey>>({ key: "name", dir: "asc" });
  const { data } = e;
  const unresolved = sortUnresolved(data.unresolved, unSort.key, unSort.dir);
  const rules = sortRules(data.rules, ruleSort.key, ruleSort.dir, e.names);
  const sortRule = (key: RuleSortKey) => setRuleSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const viaText = (n: PhaseName) => {
    const own = e.rulesBy.get(`name:${n.key}`);
    if (own) return own.targets.length ? `Its phase's tools plus ${e.names(own.targets)}` : "Needs no tools";
    if (n.via === "phase") return "Its phase's tools";
    if (n.via) return "Tools from its task type";
    return "No tools yet";
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section>
        <SectionHeading>Phases</SectionHeading>
        {data.phases.length === 0 ? (
          <EmptyState>No phases in the next 6 months.</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {data.phases.map((p) => {
              const rule = e.rulesBy.get(`phase:${p.key}`);
              const open = openPhase === p.key;
              return (
                <div key={p.key} className="grid gap-2 px-3 py-3">
                  <div>
                    <span className="text-sm font-semibold">{p.name}</span>
                    <MetaLine items={[p.jobNames.join(", "), `${p.taskCount} ${p.taskCount === 1 ? "task" : "tasks"}`, rule ? e.names(rule.targets) : <span className="text-warn">No tools yet</span>]} />
                  </div>
                  <NeedsEditor e={e} match="phase" k={p.key} label={p.name} />
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenPhase(open ? null : p.key)}
                    className="justify-self-start text-[12px] font-semibold text-neutral-500 underline-offset-2 hover:underline"
                  >
                    {open ? "Hide" : "Show"} its {p.names.length} task {p.names.length === 1 ? "name" : "names"}
                  </button>
                  {open && (
                    <ul className="grid gap-1 rounded-lg border border-line p-2">
                      {p.names.map((n) => (
                        <li key={n.key} className="grid gap-2 py-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 text-sm">
                              {n.name} <span className="text-[12px] text-neutral-500">· {viaText(n)}</span>
                            </span>
                            <Button variant="ghost" size="xs" onClick={() => setEditName(editName === n.key ? null : n.key)}>
                              {editName === n.key ? "Close" : "Add tools to this task"}
                            </Button>
                          </div>
                          {editName === n.key && <NeedsEditor e={e} match="name" k={n.key} label={n.name} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </ListCard>
        )}
      </section>

      <section>
        <SectionHeading
          trailing={
            data.unresolved.length > 1 ? (
              <SortBar
                label="Sort task names"
                sort={unSort}
                onChange={setUnSort}
                keys={[
                  { value: "tasks", label: "Tasks" },
                  { value: "name", label: "Name" },
                  { value: "job", label: "Job" },
                  { value: "phase", label: "Phase" },
                ]}
              />
            ) : undefined
          }
        >
          {data.unresolved.length ? `${data.unresolved.length} task ${data.unresolved.length === 1 ? "name has" : "names have"} no tools yet` : "Every scheduled task is covered"}
        </SectionHeading>
        {data.unresolved.length === 0 ? (
          <EmptyState>All caught up for the next 6 months.</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {unresolved.map((u) => (
              <div key={u.key} className="grid gap-2 px-3 py-3">
                <div>
                  <span className="text-sm font-semibold">{u.name}</span>
                  <MetaLine items={[u.phase, u.jobNames.join(", "), `${u.taskIds.length} ${u.taskIds.length === 1 ? "task" : "tasks"}`]} />
                </div>
                <NeedsEditor e={e} match="name" k={u.key} label={u.name} suggestions={u.suggestions} />
              </div>
            ))}
          </ListCard>
        )}
      </section>

      {data.taskTypes.length > 0 && (
        <section>
          <SectionHeading>Task types</SectionHeading>
          <ListCard className="divide-y divide-line-soft">
            {data.taskTypes.map((t) => (
              <div key={t.id} className="grid gap-2 px-3 py-3">
                <div>
                  <span className="text-sm font-semibold">{t.name}</span>
                  <MetaLine items={[`${t.taskCount} ${t.taskCount === 1 ? "task" : "tasks"}`]} />
                </div>
                <NeedsEditor e={e} match="taskType" k={t.id} label={t.name} />
              </div>
            ))}
          </ListCard>
        </section>
      )}

      <section>
        <SectionHeading>All rules</SectionHeading>
        {data.rules.length === 0 ? (
          <EmptyState>Nothing set yet.</EmptyState>
        ) : (
          <div className="relative overflow-x-auto rounded-xl border border-line">
            <table className={tableCls.root}>
              <thead>
                <tr>
                  <SortTh label="Matches" k="name" sort={ruleSort} onSort={sortRule} />
                  <SortTh label="Type" k="type" sort={ruleSort} onSort={sortRule} />
                  <SortTh label="Tools" k="tools" sort={ruleSort} onSort={sortRule} />
                  <th className={tableCls.th}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const k = `${r.match}:${r.key}`;
                  return (
                    <tr key={k} className={tableCls.tr}>
                      <td className={tableCls.td}>{r.label || r.key}</td>
                      <td className={`${tableCls.td} whitespace-nowrap text-neutral-500`}>{MATCH_LABEL[r.match]}</td>
                      <td className={`${tableCls.td} ${r.targets.length ? "" : "text-neutral-500"}`}>{e.names(r.targets)}</td>
                      <td className={`${tableCls.td} text-right`}>
                        <Button variant="ghost" size="xs" disabled={e.busyKey === k} onClick={() => void e.clearRule(r.match, r.key)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Bookings */

function Bookings() {
  const [data, setData] = useState<{ holds: ToolHold[]; tools: PickTool[]; types: PickType[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([call<{ holds: ToolHold[] }>("/api/tool-schedule/holds"), call<{ tools: PickTool[]; types: PickType[] }>("/api/tool-schedule/catalog")])
      .then(([h, c]) => setData({ holds: h.holds, tools: c.tools, types: c.types }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  async function remove(id: string) {
    setBusy(true);
    try {
      await call(`/api/tool-schedule/holds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <Banner tone="error">{error}</Banner>;
  if (!data) return <Loading />;
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {error && <Banner tone="error">{error}</Banner>}
      {data.holds.length === 0 ? (
        <EmptyState>No bookings.</EmptyState>
      ) : (
        <ListCard className="divide-y divide-line-soft">
          {data.holds.map((h) => (
            <div key={h.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {targetLabel(h.target, data.tools, data.types)}
                  {h.qty > 1 ? ` ×${h.qty}` : ""} → {h.jobName || h.jobId}
                </span>
                <MetaLine items={[`${fmt(h.startDate)} – ${fmt(h.endDate)}`, !h.jobId && "Not a job", h.note]} />
              </span>
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => remove(h.id)}>
                Remove
              </Button>
            </div>
          ))}
        </ListCard>
      )}
      <section className="grid gap-2">
        <SectionHeading>Book a tool</SectionHeading>
        <BookingForm onSaved={load} />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- Jobs */

function Jobs() {
  const [jobs, setJobs] = useState<{ id: string; name: string; excluded: boolean; tasks: number }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    call<{ jobs: NonNullable<typeof jobs> }>("/api/tool-schedule/jobs")
      .then((d) => setJobs(d.jobs))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function toggle(j: { id: string; name: string; excluded: boolean }) {
    setBusy(j.id);
    try {
      await call("/api/tool-schedule/jobs", { method: "PUT", body: JSON.stringify({ jobId: j.id, jobName: j.name, excluded: !j.excluded }) });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (error && !jobs) return <Banner tone="error">{error}</Banner>;
  if (!jobs) return <Loading label="Reading the JobTread schedules…" />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      {jobs.length === 0 ? (
        <EmptyState>No job has schedule tasks in the next 6 months.</EmptyState>
      ) : (
        <ListCard className="divide-y divide-line-soft">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${j.excluded ? "text-neutral-400 line-through" : ""}`}>{j.name || j.id}</span>
                <span className="block text-[12px] text-neutral-500">
                  {j.tasks} {j.tasks === 1 ? "task" : "tasks"}
                  {j.excluded ? " · left out" : ""}
                </span>
              </span>
              <Button variant="secondary" size="xs" disabled={busy === j.id} onClick={() => toggle(j)}>
                {j.excluded ? "Count it" : "Leave out"}
              </Button>
            </div>
          ))}
        </ListCard>
      )}
    </div>
  );
}
