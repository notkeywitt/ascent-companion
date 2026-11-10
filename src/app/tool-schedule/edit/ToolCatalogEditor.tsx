"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  btn,
  Button,
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
import { sortRules, sortUnresolved, type RuleSortKey, type SortDir, type UnresolvedSortKey } from "@/lib/toolScheduleView";
import { BookingForm } from "../BookingForm";
import { AssignedTasks, call, MATCH_LABEL, useTaskRules, type Editing, type PhaseName } from "../TaskAssign";
import { RequisitionPrompt, TargetPicker, targetLabel, type PickGroup, type PickTool, type PickType } from "../ToolPickers";

/**
 * The tool schedule's editor (docs/plans/TOOL_SCHEDULE_PLAN.md), for the office.
 * Each tool's tasks, group and trailer are set on the Tools page, in its edit
 * dialog; each schedule task's tools on the Tool Schedule's Gantt. Here:
 *   Types & groups — "any tool of a type" and whole groups: which tasks
 *              each is assigned to, and tool types the company does not own.
 *   Tasks    — the phases, task names and task types the schedule uses: what
 *              each one needs, and "Add tool". A task needs its phase's tools
 *              plus its own.
 *   Bookings — book a tool by hand, for a job or a place, with no task.
 *   Jobs     — leave a job's schedule out (a PreCon copy of another Gantt).
 * Naming a tool type no tool of is free for offers a requisition.
 */

export type EditorTab = "tools" | "tasks" | "bookings" | "jobs";

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

export function ToolCatalogEditor({ initialTab }: { initialTab: EditorTab }) {
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const { editing, error, load, prompt, clearPrompt } = useTaskRules();

  const items: { key: EditorTab; label: string }[] = [
    { key: "tools", label: "Types & groups" },
    { key: "tasks", label: editing?.data.unresolved.length ? `Tasks (${editing.data.unresolved.length})` : "Tasks" },
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
      <Tabs label="Section" items={items.map((t) => ({ key: t.key, label: t.label, active: tab === t.key, onClick: () => setTab(t.key) }))} />
      {error && <Banner tone="error" className="mb-4">{error}</Banner>}
      {editing?.data.toolsError && <Banner tone="warning" className="mb-4">The Tools list could not be read: {editing.data.toolsError}</Banner>}
      {tab === "jobs" ? (
        <Jobs />
      ) : !editing ? (
        error ? null : <Loading label="Reading the Tools list and the JobTread schedules…" />
      ) : tab === "tools" ? (
        <TypesView e={editing} reload={load} />
      ) : tab === "tasks" ? (
        <TasksView e={editing} />
      ) : (
        <Bookings />
      )}
      {prompt && <RequisitionPrompt shortages={prompt} onClose={clearPrompt} />}
    </main>
  );
}

/* ---------------------------------------------------------- Types & groups */

/** One tool type or group: what it is, the tasks it is assigned to, and "Assign to tasks". */
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
  const count = e.data.rules.filter((r) => r.targets.includes(target)).length;
  return (
    <div className="grid gap-2 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`text-sm font-semibold ${danger ? "text-danger" : ""}`}>{title}</span>
          <MetaLine items={meta} />
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-neutral-500">
          {count} {count === 1 ? "task" : "tasks"}
        </span>
      </div>
      <AssignedTasks e={e} target={target} extra={extra} />
    </div>
  );
}

function TypesView({ e, reload }: { e: Editing; reload: () => void }) {
  const [q, setQ] = useState("");
  const [newType, setNewType] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(e.data.tools.map((t) => [t.id, t.name]));
  const types = e.data.types.filter((t) => matchesAllWords(`any ${t.name}`, q));
  const groups = e.data.groups.filter((g) => matchesAllWords(`${g.name} ${g.toolIds.map((id) => names.get(id) ?? "").join(" ")}`, q));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        A single tool&apos;s tasks, group and trailer are set on the{" "}
        <Link href="/tools" className="font-semibold underline">
          Tools page
        </Link>
        : tap the tool, then Edit. A schedule task&apos;s tools are set by tapping its bar on the Tool Schedule.
      </p>
      <Input id="catalog-search" placeholder="Search types and groups…" aria-label="Search types and groups" value={q} onChange={(ev) => setQ(ev.target.value)} className="sm:!w-72" />

      <section>
        <SectionHeading>Groups — every tool in the group goes</SectionHeading>
        {groups.length === 0 ? (
          <EmptyState>{e.data.groups.length ? "No group matches." : "No groups yet. Give tools the same Tool group on the Tools page."}</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {groups.map((g) => (
              <TargetRow key={g.id} e={e} target={`group:${g.id}`} title={g.name} meta={[g.toolIds.map((id) => names.get(id) ?? id).join(", ")]} />
            ))}
          </ListCard>
        )}
      </section>

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
      <TargetPicker tools={e.data.tools} types={e.data.types} groups={e.data.groups} exclude={draft} onPick={(t) => setDraft([...draft, t])} onAddType={e.addType} />
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
  const [data, setData] = useState<{ holds: ToolHold[]; tools: PickTool[]; types: PickType[]; groups: PickGroup[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([call<{ holds: ToolHold[] }>("/api/tool-schedule/holds"), call<{ tools: PickTool[]; types: PickType[]; groups?: PickGroup[] }>("/api/tool-schedule/catalog")])
      .then(([h, c]) => setData({ holds: h.holds, tools: c.tools, types: c.types, groups: c.groups ?? [] }))
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
                  {targetLabel(h.target, data.tools, data.types, data.groups)}
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
