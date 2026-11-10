"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CostCodeSelect } from "@/components/CostCodeSelect";
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
import type { CostCodeRef } from "@/lib/jobtread";
import type { RuleMatch, ToolHold } from "@/lib/toolSchedule";

/**
 * The tool schedule's editor (docs/plans/TOOL_SCHEDULE_PLAN.md), for the office:
 *   Catalogue  — tool types, the cost codes each is needed for, and which
 *                Tools-list tools are which type.
 *   Task codes — map each schedule task name to a cost code once.
 *   Holds      — reserve a tool type for a job by hand.
 *   Jobs       — leave a job's schedule out (a PreCon copy of another Gantt).
 * Companion data only: nothing here writes to JobTread.
 */

export type EditorTab = "catalogue" | "tasks" | "holds" | "jobs";

interface Kind {
  id: string;
  name: string;
  notes: string;
  costCodeIds: string[];
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

const codeLabel = (c: CostCodeRef | undefined, id: string) => (c ? `${c.number} ${c.name}` : id);

export function ToolCatalogEditor({ initialTab }: { initialTab: EditorTab }) {
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [unresolved, setUnresolved] = useState<number | null>(null);
  const items: { key: EditorTab; label: React.ReactNode }[] = [
    { key: "catalogue", label: "Catalogue" },
    { key: "tasks", label: unresolved ? `Task codes (${unresolved})` : "Task codes" },
    { key: "holds", label: "Holds" },
    { key: "jobs", label: "Jobs" },
  ];
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-4xl">
      <PageHeader
        title="Edit Tool Schedule"
        description="Say which tools each cost code needs. The schedule does the rest."
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
      {tab === "tasks" && <TaskCodes onCount={setUnresolved} />}
      {tab === "holds" && <Holds />}
      {tab === "jobs" && <Jobs />}
    </main>
  );
}

/* --------------------------------------------------------------- Catalogue */

function Catalogue() {
  const [data, setData] = useState<{ kinds: Kind[]; members: Record<string, string>; costCodes: CostCodeRef[]; tools: SheetTool[]; toolsError?: string } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call<typeof data>("/api/tool-schedule/catalog")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const codes = useMemo(() => new Map((data?.costCodes ?? []).map((c) => [c.id, c])), [data]);

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
      <p className="text-[12px] text-neutral-500">
        A tool type counts as needed on every day a scheduled task with one of its cost codes runs.
      </p>
      {data.kinds.length === 0 ? (
        <EmptyState>No tool types yet. Add the first one above.</EmptyState>
      ) : (
        <ListCard className="divide-y divide-line-soft">
          {data.kinds.map((k) =>
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
                    {k.costCodeIds.length ? k.costCodeIds.map((id) => codeLabel(codes.get(id), id)).join(" · ") : "No cost codes — holds only"}
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
  data: { kinds: Kind[]; members: Record<string, string>; costCodes: CostCodeRef[]; tools: SheetTool[] };
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(kind.name);
  const [codes, setCodes] = useState<string[]>(kind.costCodeIds);
  const [toolIds, setToolIds] = useState<string[]>(Object.keys(data.members).filter((t) => data.members[t] === kind.id));
  const [filter, setFilter] = useState(toolIds.length ? "" : kind.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byCode = new Map(data.costCodes.map((c) => [c.id, c]));
  const kindName = new Map(data.kinds.map((k) => [k.id, k.name]));
  const q = filter.trim().toLowerCase();
  const shown = data.tools
    .filter((t) => !q || `${t.name} ${t.type} ${t.toolGroup}`.toLowerCase().includes(q) || toolIds.includes(t.id))
    .sort((a, b) => Number(toolIds.includes(b.id)) - Number(toolIds.includes(a.id)) || a.name.localeCompare(b.name));

  async function save() {
    setBusy(true);
    try {
      await call("/api/tool-schedule/catalog", { method: "PATCH", body: JSON.stringify({ id: kind.id, name, costCodeIds: codes, toolIds }) });
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
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Needed for these cost codes</span>
        {codes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {codes.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-md border border-line-strong py-0.5 pl-2 text-[12px]">
                <span className="font-mono text-[11px] text-neutral-500">{byCode.get(id)?.number}</span>
                {byCode.get(id)?.name ?? id}
                <button type="button" aria-label={`Remove ${byCode.get(id)?.name ?? id}`} onClick={() => setCodes(codes.filter((c) => c !== id))} className="min-h-7 min-w-7 text-neutral-500">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <CostCodeSelect
          inline
          options={data.costCodes.filter((c) => !codes.includes(c.id))}
          value=""
          onChange={(id) => id && setCodes([...codes, id])}
        />
      </div>

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
            <span className="text-[12px] text-danger">Delete it, its codes and its holds?</span>
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

/* -------------------------------------------------------------- Task codes */

interface Unresolved {
  key: string;
  name: string;
  phase: string;
  jobNames: string[];
  taskIds: string[];
  suggestions: CostCodeRef[];
}
interface Rule {
  match: RuleMatch;
  key: string;
  costCodeId: string | null;
  label: string;
  updatedBy: string;
  updatedAt: string;
}

const MATCH_LABEL: Record<RuleMatch, string> = { task: "One task", name: "Task name", taskType: "Task type", phase: "Phase" };

function TaskCodes({ onCount }: { onCount: (n: number) => void }) {
  const [data, setData] = useState<{ rules: Rule[]; unresolved: Unresolved[]; costCodes: CostCodeRef[] } | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [byPhase, setByPhase] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    call<NonNullable<typeof data>>("/api/tool-schedule/rules")
      .then((d) => {
        setData(d);
        onCount(d.unresolved.length);
      })
      .catch((e) => setError(e.message));
  }, [onCount]);
  useEffect(load, [load]);

  const codes = useMemo(() => new Map((data?.costCodes ?? []).map((c) => [c.id, c])), [data]);

  async function map(u: Unresolved, costCodeId: string | null) {
    const phase = byPhase[u.key] && u.phase;
    setBusyKey(u.key);
    try {
      await call("/api/tool-schedule/rules", {
        method: "PUT",
        body: JSON.stringify(phase ? { match: "phase", key: u.phase, label: u.phase, costCodeId } : { match: "name", key: u.name, label: u.name, costCodeId }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  }
  async function change(r: Rule, costCodeId: string | null) {
    setBusyKey(`${r.match}:${r.key}`);
    try {
      await call("/api/tool-schedule/rules", { method: "PUT", body: JSON.stringify({ match: r.match, key: r.key, label: r.label, costCodeId }) });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  }
  async function remove(r: Rule) {
    setBusyKey(`${r.match}:${r.key}`);
    try {
      await call(`/api/tool-schedule/rules?match=${r.match}&key=${encodeURIComponent(r.key)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  }

  if (error && !data) return <Banner tone="error">{error}</Banner>;
  if (!data) return <Loading label="Reading the JobTread schedules…" />;
  const codeOptions = data.costCodes.map((c) => (
    <option key={c.id} value={c.id}>
      {c.number} {c.name}
    </option>
  ));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {error && <Banner tone="error">{error}</Banner>}
      <p className="text-[12px] text-neutral-500">
        JobTread schedule tasks carry no cost code. Map each task name once; the same name then maps on every job. A task
        that needs no tools still needs an answer, so it leaves this list.
      </p>
      <section>
        <SectionHeading>
          {data.unresolved.length ? `${data.unresolved.length} task ${data.unresolved.length === 1 ? "name needs" : "names need"} a code` : "Every scheduled task has a code"}
        </SectionHeading>
        {data.unresolved.length === 0 ? (
          <EmptyState>All caught up for the next 6 months.</EmptyState>
        ) : (
          <ListCard className="divide-y divide-line-soft">
            {data.unresolved.map((u) => {
              const phase = byPhase[u.key] && u.phase;
              return (
                <div key={u.key} className="grid gap-2 px-3 py-3">
                  <div>
                    <span className="text-sm font-semibold">{phase ? `Phase: ${u.phase}` : u.name}</span>
                    <MetaLine items={[!phase && u.phase, u.jobNames.join(", "), `${u.taskIds.length} ${u.taskIds.length === 1 ? "task" : "tasks"}`]} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {u.suggestions.map((c) => (
                      <Button key={c.id} variant="secondary" size="xs" disabled={busyKey === u.key} onClick={() => map(u, c.id)} className="max-w-full whitespace-normal text-left">
                        ✓ <span className="font-mono text-[11px] text-neutral-500">{c.number}</span> {c.name}
                      </Button>
                    ))}
                    <Select
                      aria-label={`Choose another code for ${u.name}`}
                      value=""
                      disabled={busyKey === u.key}
                      onChange={(e) => e.target.value && map(u, e.target.value)}
                      className="!w-auto max-w-full text-xs"
                    >
                      <option value="">Other code…</option>
                      {codeOptions}
                    </Select>
                    <Button variant="ghost" size="xs" disabled={busyKey === u.key} onClick={() => map(u, null)}>
                      Needs no tools
                    </Button>
                    {u.phase && (
                      <Button variant="ghost" size="xs" onClick={() => setByPhase({ ...byPhase, [u.key]: !byPhase[u.key] })}>
                        {phase ? "Map this task name instead" : "Map the whole phase instead"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </ListCard>
        )}
      </section>

      <section>
        <SectionHeading>Mapped</SectionHeading>
        {data.rules.length === 0 ? (
          <EmptyState>Nothing mapped yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className={tableCls.root}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Matches</th>
                  <th className={tableCls.th}>Cost code</th>
                  <th className={tableCls.th}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.rules]
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((r) => {
                    const k = `${r.match}:${r.key}`;
                    return (
                      <tr key={k} className={tableCls.tr}>
                        <td className={tableCls.td}>
                          {r.label || r.key}
                          <div className="text-[11px] text-neutral-500">{MATCH_LABEL[r.match]}</div>
                        </td>
                        <td className={tableCls.td}>
                          <Select
                            aria-label={`Cost code for ${r.label}`}
                            value={r.costCodeId ?? ""}
                            disabled={busyKey === k}
                            onChange={(e) => change(r, e.target.value || null)}
                            className="text-xs"
                          >
                            <option value="">Needs no tools</option>
                            {r.costCodeId && !codes.has(r.costCodeId) && <option value={r.costCodeId}>Archived code</option>}
                            {codeOptions}
                          </Select>
                        </td>
                        <td className={`${tableCls.td} text-right`}>
                          <Button variant="ghost" size="xs" disabled={busyKey === k} onClick={() => remove(r)}>
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

/* ------------------------------------------------------------------- Holds */

function Holds() {
  const [data, setData] = useState<{ holds: ToolHold[]; kinds: { id: string; name: string }[]; jobs: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kindId: "", jobId: "", startDate: "", endDate: "", qty: "1", note: "" });

  const load = useCallback(() => {
    call<NonNullable<typeof data>>("/api/tool-schedule/holds")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function add() {
    setBusy(true);
    setError("");
    try {
      const jobName = data?.jobs.find((j) => j.id === form.jobId)?.name ?? "";
      await call("/api/tool-schedule/holds", { method: "POST", body: JSON.stringify({ ...form, qty: Number(form.qty) || 1, jobName }) });
      setForm({ ...form, note: "" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
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
  const ready = form.kindId && form.jobId && form.startDate && form.endDate && form.endDate >= form.startDate;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {error && <Banner tone="error">{error}</Banner>}
      <p className="text-[12px] text-neutral-500">
        A hold reserves a tool type for a job outside the schedule: a known need before the job has a Gantt, or a tool
        kept on site. It counts like a scheduled task.
      </p>
      {data.holds.length === 0 ? (
        <EmptyState>No holds.</EmptyState>
      ) : (
        <ListCard className="divide-y divide-line-soft">
          {data.holds.map((h) => (
            <div key={h.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {kindName.get(h.kindId) ?? "Deleted tool type"}
                  {h.qty > 1 ? ` ×${h.qty}` : ""} → {h.jobName || h.jobId}
                </span>
                <MetaLine items={[`${fmt(h.startDate)} – ${fmt(h.endDate)}`, h.note]} />
              </span>
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => remove(h.id)}>
                Remove
              </Button>
            </div>
          ))}
        </ListCard>
      )}

      <section className="grid gap-2">
        <SectionHeading>Add a hold</SectionHeading>
        {data.kinds.length === 0 ? (
          <p className="text-sm text-neutral-500">Add a tool type in Catalogue first.</p>
        ) : (
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) void add();
            }}
          >
            <Select id="hold-kind" aria-label="Tool type" value={form.kindId} onChange={(e) => setForm({ ...form, kindId: e.target.value })}>
              <option value="">Tool type…</option>
              {data.kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </Select>
            <Select id="hold-job" aria-label="Job" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })}>
              <option value="">Job…</option>
              {data.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </Select>
            <label className="grid gap-1 text-[12px] text-neutral-500">
              From
              <Input id="hold-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[12px] text-neutral-500">
              To
              <Input id="hold-end" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[12px] text-neutral-500">
              How many
              <Input id="hold-qty" type="number" min={1} max={20} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[12px] text-neutral-500">
              Note
              <Input id="hold-note" value={form.note} placeholder="Why" onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || !ready}>
                Add hold
              </Button>
            </div>
          </form>
        )}
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
      <p className="text-[12px] text-neutral-500">
        Jobs with schedule tasks in the next 6 months. Leave out a job whose Gantt is a copy of another job&apos;s (a PreCon
        job), or both count and its tool needs double.
      </p>
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
