"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookingForm } from "../BookingForm";
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
import type { RuleMatch, ToolHold } from "@/lib/toolSchedule";
import {
  sortKinds,
  sortRules,
  sortUnresolved,
  type KindSortKey,
  type RuleSortKey,
  type SortDir,
  type UnresolvedSortKey,
} from "@/lib/toolScheduleView";

/**
 * The tool schedule's editor (docs/plans/TOOL_SCHEDULE_PLAN.md), for the office:
 *   Catalogue  — tool types, and which Tools-list tools are which type.
 *   Tasks      — tick the tools each phase needs (covers every task under it),
 *                and a task name's own tools where it needs something else.
 *   Bookings   — book a tool by hand, for a job or a place, with no task.
 *   Jobs       — leave a job's schedule out (a PreCon copy of another Gantt).
 * Companion data only: nothing here writes to JobTread.
 */

export type EditorTab = "catalogue" | "tasks" | "bookings" | "jobs";

interface Kind {
  id: string;
  name: string;
  notes: string;
}
interface SheetTool {
  id: string;
  name: string;
  type: string;
  toolGroup: string;
  condition: string;
  locationLabel: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}


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
      <Select
        aria-label={label}
        value={sort.key}
        onChange={(e) => onChange({ ...sort, key: e.target.value as K })}
        className="!w-auto max-w-full text-xs"
      >
        {keys.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="xs"
        aria-label={`${label}: ${asc ? "ascending" : "descending"}. Switch order`}
        onClick={() => onChange({ ...sort, dir: asc ? "desc" : "asc" })}
      >
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
export function ToolCatalogEditor({ initialTab }: { initialTab: EditorTab }) {
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [unresolved, setUnresolved] = useState<number | null>(null);
  const items: { key: EditorTab; label: React.ReactNode }[] = [
    { key: "catalogue", label: "Catalogue" },
    { key: "tasks", label: unresolved ? `Tasks (${unresolved})` : "Tasks" },
    { key: "bookings", label: "Bookings" },
    { key: "jobs", label: "Jobs" },
  ];
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
      <Tabs
        label="Section"
        items={items.map((t) => ({ key: t.key, label: t.label, active: tab === t.key, onClick: () => setTab(t.key) }))}
      />
      {tab === "catalogue" && <Catalogue />}
      {tab === "tasks" && <Tasks onCount={setUnresolved} />}
      {tab === "bookings" && <Bookings />}
      {tab === "jobs" && <Jobs />}
    </main>
  );
}

/* --------------------------------------------------------------- Catalogue */

interface CatalogData {
  kinds: Kind[];
  members: Record<string, string>;
  /** How many task rules tick each tool type. */
  uses: Record<string, number>;
  tools: SheetTool[];
  toolsError?: string;
}

function Catalogue() {
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<Sort<KindSortKey>>({ key: "name", dir: "asc" });

  const load = useCallback(() => {
    call<typeof data>("/api/tool-schedule/catalog")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const { id } = await call<{ id: string }>("/api/tool-schedule/catalog", { method: "POST", body: JSON.stringify({ name: newName }) });
      setNewName("");
      setOpen(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <Banner tone="error">{error}</Banner>;
  if (!data) return <Loading />;
  const owned = (kindId: string) => Object.values(data.members).filter((k) => k === kindId).length;
  const uses = (kindId: string) => data.uses[kindId] ?? 0;
  const kinds = sortKinds(data.kinds, sort.key, sort.dir, owned, uses);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      {data.toolsError && <Banner tone="warning">The Tools list could not be read: {data.toolsError}</Banner>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input id="new-kind" placeholder="New tool type, e.g. Table saw" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New tool type" />
        <Button type="submit" disabled={busy || !newName.trim()} className="shrink-0">
          Add tool type
        </Button>
      </form>
      {data.kinds.length > 1 && (
        <div className="flex justify-end">
          <SortBar
            label="Sort tool types"
            sort={sort}
            onChange={setSort}
            keys={[
              { value: "name", label: "Name" },
              { value: "owned", label: "Owned" },
              { value: "uses", label: "Used by" },
            ]}
          />
        </div>
      )}
      {data.kinds.length === 0 ? (
        <EmptyState>No tool types yet. Add the first one above.</EmptyState>
      ) : (
        <ListCard className="divide-y divide-line-soft">
          {kinds.map((k) =>
            open === k.id ? (
              <KindEditor
                key={k.id}
                kind={k}
                data={data}
                onDone={() => {
                  setOpen(null);
                  load();
                }}
                onError={setError}
              />
            ) : (
              <button key={k.id} type="button" onClick={() => setOpen(k.id)} className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{k.name}</span>
                  <span className="block text-[12px] text-neutral-500 dark:text-neutral-400">
                    {uses(k.id) ? `Ticked on ${uses(k.id)} ${uses(k.id) === 1 ? "phase or task" : "phases or tasks"}` : "Not on any phase or task yet"}
                  </span>
                </span>
                <span className={`shrink-0 text-[12px] tabular-nums ${owned(k.id) ? "text-neutral-500" : "font-semibold text-danger"}`}>
                  {owned(k.id)} owned
                </span>
              </button>
            ),
          )}
        </ListCard>
      )}
    </div>
  );
}

function KindEditor({
  kind,
  data,
  onDone,
  onError,
}: {
  kind: Kind;
  data: CatalogData;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(kind.name);
  const [toolIds, setToolIds] = useState<string[]>(Object.keys(data.members).filter((t) => data.members[t] === kind.id));
  const [filter, setFilter] = useState(toolIds.length ? "" : kind.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const kindName = new Map(data.kinds.map((k) => [k.id, k.name]));
  const q = filter.trim().toLowerCase();
  const shown = data.tools
    .filter((t) => !q || `${t.name} ${t.type} ${t.toolGroup}`.toLowerCase().includes(q) || toolIds.includes(t.id))
    .sort((a, b) => Number(toolIds.includes(b.id)) - Number(toolIds.includes(a.id)) || a.name.localeCompare(b.name));

  async function save() {
    setBusy(true);
    try {
      await call("/api/tool-schedule/catalog", { method: "PATCH", body: JSON.stringify({ id: kind.id, name, toolIds }) });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await call(`/api/tool-schedule/catalog?id=${encodeURIComponent(kind.id)}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 bg-neutral-50 px-3 py-4 dark:bg-white/[0.03]">
      <label className="grid gap-1 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Name</span>
        <Input id={`kind-name-${kind.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="grid gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Which tools in the Tools list are a {name.toLowerCase() || "tool of this type"} ({toolIds.length} chosen)
        </span>
        <Input id={`kind-filter-${kind.id}`} placeholder="Filter the Tools list" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter the Tools list" />
        <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
          {shown.length === 0 && <p className="text-sm text-neutral-500">No tool matches.</p>}
          {shown.map((t) => {
            const other = data.members[t.id] && data.members[t.id] !== kind.id ? kindName.get(data.members[t.id]) : null;
            return (
              <Checkbox
                key={t.id}
                checked={toolIds.includes(t.id)}
                onChange={(e) => setToolIds(e.target.checked ? [...toolIds, t.id] : toolIds.filter((x) => x !== t.id))}
                label={
                  <span className="min-w-0">
                    {t.name}
                    <span className="text-[12px] text-neutral-500">
                      {[t.type, other && `now: ${other}`, t.condition].filter(Boolean).map((s) => ` · ${s}`).join("")}
                    </span>
                  </span>
                }
              />
            );
          })}
        </div>
        <p className="text-[12px] text-neutral-500">A tool belongs to one tool type. Ticking a tool that is another type moves it here.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy || !name.trim()}>
          Save
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <span className="flex-1" />
        {confirmDelete ? (
          <>
            <span className="text-[12px] text-danger">Delete it, its task ticks and its bookings?</span>
            <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete tool type
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Tasks */

interface Rule {
  match: RuleMatch;
  key: string;
  kindIds: string[];
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
  suggestions: string[];
}
interface TasksData {
  rules: Rule[];
  kinds: { id: string; name: string }[];
  phases: PhaseRow[];
  taskTypes: { id: string; name: string; taskCount: number }[];
  unresolved: Unresolved[];
}

const MATCH_LABEL: Record<RuleMatch, string> = { task: "One task", name: "Task name", taskType: "Task type", phase: "Phase" };
const VIA_LABEL: Record<RuleMatch, string> = { task: "Own tools (this job)", name: "Own tools", taskType: "From its task type", phase: "From the phase" };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Tick the tool types a phase, task name or task type needs. The ticks are a
 * draft until Save. "Needs no tools" covers it with nothing; Clear removes the
 * rule so it falls back to the next level (a task name to its phase).
 */
function ToolTicks({
  kinds,
  saved,
  initial,
  suggested = false,
  busy,
  onSave,
  onClear,
}: {
  kinds: { id: string; name: string }[];
  /** The rule's tools now; null when there is no rule. */
  saved: string[] | null;
  /** The first draft: the saved tools, or suggestions. */
  initial: string[];
  suggested?: boolean;
  busy: boolean;
  onSave: (kindIds: string[]) => void;
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(initial);
  const toggle = (id: string) => setDraft(draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id]);
  const changed = saved === null ? draft.length > 0 : !sameSet(draft, saved);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => {
          const on = draft.includes(k.id);
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(k.id)}
              className={`min-h-8 rounded-full border px-3 text-[12px] font-medium transition ${
                on ? "border-accent bg-accent/15 text-accent dark:text-accent-soft" : "border-line-strong text-neutral-600 hover:border-accent dark:text-neutral-300"
              }`}
            >
              {on ? "✓ " : ""}
              {k.name}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={busy || !changed || draft.length === 0} onClick={() => onSave(draft)}>
          Save
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || (saved !== null && saved.length === 0)} onClick={() => onSave([])}>
          Needs no tools
        </Button>
        {saved !== null && onClear && (
          <Button variant="ghost" size="xs" disabled={busy} onClick={onClear}>
            Clear
          </Button>
        )}
        {suggested && saved === null && draft.length > 0 && sameSet(draft, initial) && (
          <span className="text-[11px] text-neutral-500">Suggested from similar tasks</span>
        )}
        {saved !== null && saved.length === 0 && <span className="text-[11px] text-neutral-500">Needs no tools</span>}
      </div>
    </div>
  );
}

function Tasks({ onCount }: { onCount: (n: number) => void }) {
  const [data, setData] = useState<TasksData | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [unSort, setUnSort] = useState<Sort<UnresolvedSortKey>>({ key: "tasks", dir: "desc" });
  const [ruleSort, setRuleSort] = useState<Sort<RuleSortKey>>({ key: "name", dir: "asc" });

  const load = useCallback(() => {
    call<TasksData>("/api/tool-schedule/rules")
      .then((d) => {
        setData(d);
        onCount(d.unresolved.length);
      })
      .catch((e) => setError(e.message));
  }, [onCount]);
  useEffect(load, [load]);

  const rulesBy = useMemo(() => new Map((data?.rules ?? []).map((r) => [`${r.match}:${r.key}`, r])), [data]);
  const kindName = useMemo(() => new Map((data?.kinds ?? []).map((k) => [k.id, k.name])), [data]);
  const toolNames = (ids: string[]) => (ids.length ? ids.map((id) => kindName.get(id) ?? "Deleted tool").join(", ") : "Needs no tools");

  async function save(match: RuleMatch, key: string, label: string, kindIds: string[]) {
    setBusyKey(`${match}:${key}`);
    setError("");
    try {
      await call("/api/tool-schedule/rules", { method: "PUT", body: JSON.stringify({ match, key, label, kindIds }) });
      setEditName(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  }
  async function clear(match: RuleMatch, key: string) {
    setBusyKey(`${match}:${key}`);
    setError("");
    try {
      await call(`/api/tool-schedule/rules?match=${match}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
      setEditName(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  }

  if (error && !data) return <Banner tone="error">{error}</Banner>;
  if (!data) return <Loading label="Reading the JobTread schedules…" />;
  if (data.kinds.length === 0) return <EmptyState>Add tool types in Catalogue first.</EmptyState>;

  const ticks = (match: RuleMatch, key: string, label: string, suggestions: string[] = []) => {
    const rule = rulesBy.get(`${match}:${key}`);
    const saved = rule ? rule.kindIds : null;
    return (
      <ToolTicks
        key={`${match}:${key}:${saved?.join(",") ?? "-"}`}
        kinds={data.kinds}
        saved={saved}
        initial={saved ?? suggestions}
        suggested={suggestions.length > 0}
        busy={busyKey === `${match}:${key}`}
        onSave={(ids) => save(match, key, label, ids)}
        onClear={() => clear(match, key)}
      />
    );
  };
  const unresolved = sortUnresolved(data.unresolved, unSort.key, unSort.dir);
  const rules = sortRules(data.rules, ruleSort.key, ruleSort.dir, toolNames);
  const sortRule = (key: RuleSortKey) =>
    setRuleSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {error && <Banner tone="error">{error}</Banner>}

      <section>
        <SectionHeading>Phases</SectionHeading>
        {data.phases.length === 0 ? (
          <EmptyState>No phases in the next 6 months.</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {data.phases.map((p) => {
              const rule = rulesBy.get(`phase:${p.key}`);
              const open = openPhase === p.key;
              return (
                <div key={p.key} className="grid gap-2 px-3 py-3">
                  <div>
                    <span className="text-sm font-semibold">{p.name}</span>
                    <MetaLine
                      items={[
                        p.jobNames.join(", "),
                        `${p.taskCount} ${p.taskCount === 1 ? "task" : "tasks"}`,
                        rule ? toolNames(rule.kindIds) : <span className="text-warn">No tools yet</span>,
                      ]}
                    />
                  </div>
                  {ticks("phase", p.key, p.name)}
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
                      {p.names.map((n) => {
                        const own = rulesBy.get(`name:${n.key}`);
                        return (
                          <li key={n.key} className="grid gap-2 py-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="min-w-0 text-sm">
                                {n.name}{" "}
                                <span className="text-[12px] text-neutral-500">
                                  · {n.via ? (n.via === "name" && own ? `Own tools: ${toolNames(own.kindIds)}` : VIA_LABEL[n.via]) : "No tools yet"}
                                </span>
                              </span>
                              <Button variant="ghost" size="xs" onClick={() => setEditName(editName === n.key ? null : n.key)}>
                                {editName === n.key ? "Close" : own ? "Change its tools" : "Give it its own tools"}
                              </Button>
                            </div>
                            {editName === n.key && ticks("name", n.key, n.name)}
                          </li>
                        );
                      })}
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
          {data.unresolved.length
            ? `${data.unresolved.length} task ${data.unresolved.length === 1 ? "name has" : "names have"} no tools yet`
            : "Every scheduled task is covered"}
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
                {ticks("name", u.key, u.name, u.suggestions)}
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
                {ticks("taskType", t.id, t.name)}
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
                      <td className={`${tableCls.td} ${r.kindIds.length ? "" : "text-neutral-500"}`}>{toolNames(r.kindIds)}</td>
                      <td className={`${tableCls.td} text-right`}>
                        <Button variant="ghost" size="xs" disabled={busyKey === k} onClick={() => clear(r.match, r.key)}>
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
  const [data, setData] = useState<{ holds: ToolHold[]; kinds: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call<NonNullable<typeof data>>("/api/tool-schedule/holds")
      .then(setData)
      .catch((e) => setError(e.message));
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
  const kindName = new Map(data.kinds.map((k) => [k.id, k.name]));
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
                  {kindName.get(h.kindId) ?? "Deleted tool type"}
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
