"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JobPicker, type JobRef } from "@/components/JobPicker";
import {
  Banner,
  Button,
  Card,
  IconButton,
  Loading,
  QuietInput,
  Select,
  Textarea,
  quietInputCls,
} from "@/components/ui";
import { addDays, shortDay, weekStart } from "@/lib/timeEntryDates";
import { orgDay } from "@/lib/orgTime";
import {
  buildGrid,
  endAfter,
  fmtClock,
  originalEnd,
  parseHours,
  rowLabel,
  type GridEntry,
  type GridRow,
} from "./weekGrid";

/**
 * SPLIT VIEW — the office's two-windows-side-by-side habit, in one screen.
 * Left: the signed-in person's week. Right: the employee picked above it. Rows
 * are customer › job, columns the seven days, the same shape as the sheet the
 * office used to open twice.
 *
 * Each side keeps its OWN selected cell, so your Wednesday and their Thursday
 * can be open at once. Your side edits: hours and note on an entry, or a new
 * entry in any cell. Their side only reads. Rows they have and you don't show
 * on your side as ghost rows, ready to log into; "+ Add customer" adds one for
 * any other job.
 *
 * Every write is an existing one: an edit is the Timesheets tab's `op: "edit"`
 * (same owner check), a new entry is the Log-a-range POST /api/employee-time
 * (same Time Entries log, same detached JobTread write). The other person's
 * time is read through /api/employee-time/history `actingAs`, which the server
 * allows for admin and office only.
 */

interface Entry extends GridEntry {
  costItemId: string;
  costCode: string;
  payType: string;
  notes: string;
  approved: boolean;
  /** Sent, not yet read back from JobTread (the create is detached). */
  pending?: boolean;
}

interface Side {
  entries: Entry[];
  loading: boolean;
  err: string;
  name: string;
}

interface CostItem {
  id: string;
  number: string;
  name: string;
  detail?: string;
}

type User = { id: string; name: string; types?: { name: string }[] };

const EMPTY: Side = { entries: [], loading: false, err: "", name: "" };
// The office compares against Ty by default (owner's ask, 2026-10-01).
const DEFAULT_OTHER = /^ty(ler)?\b/i;
const orgToday = () => orgDay(new Date().toISOString());

export function WeekCompare({
  users,
  appUserIds,
  myId,
  jobs,
  orgTypes,
}: {
  users: User[];
  appUserIds: string[];
  myId: string;
  jobs: JobRef[];
  orgTypes: string[];
}) {
  const others = useMemo(() => {
    const app = new Set(appUserIds);
    return users.filter((u) => app.has(u.id) && u.id !== myId).sort((a, b) => a.name.localeCompare(b.name));
  }, [users, appUserIds, myId]);

  const [week, setWeek] = useState(() => weekStart(orgToday()));
  const [otherId, setOtherId] = useState(() => others.find((u) => DEFAULT_OTHER.test(u.name))?.id ?? "");
  const [mine, setMine] = useState<Side>(EMPTY);
  const [theirs, setTheirs] = useState<Side>(EMPTY);
  const [pending, setPending] = useState<Entry[]>([]);
  const [added, setAdded] = useState<{ key: string; label: string }[]>([]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  const load = useCallback(
    async (actingAs: string, set: (s: Side) => void, quiet = false) => {
      if (!quiet) set({ ...EMPTY, loading: true });
      const qs = `start=${days[0]}&end=${days[6]}${actingAs ? `&actingAs=${encodeURIComponent(actingAs)}` : ""}`;
      try {
        const res = await fetch(`/api/employee-time/history?${qs}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || j.ok === false) set({ ...EMPTY, err: j.error || "Could not load the week." });
        else set({ entries: j.entries ?? [], loading: false, err: "", name: j.subject?.name ?? "" });
      } catch {
        set({ ...EMPTY, err: "Couldn't reach the server." });
      }
    },
    [days],
  );

  const loadMine = useCallback((quiet = false) => load("", setMine, quiet), [load]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);
  useEffect(() => {
    if (otherId) load(otherId, setTheirs);
    else setTheirs(EMPTY);
  }, [otherId, load]);

  // A new entry shows at once, then gives way to the real one when JobTread has
  // it (matched on job, day and start).
  const myEntries = useMemo(
    () => [
      ...mine.entries,
      ...pending.filter(
        (p) => !mine.entries.some((e) => e.jobId === p.jobId && e.date === p.date && e.startTime === p.startTime),
      ),
    ],
    [mine.entries, pending],
  );

  // Ghost rows on your side: every customer they logged that you didn't, plus
  // any you added by hand. buildGrid drops the ones you already have.
  const theirRows = useMemo(() => buildGrid(theirs.entries, days).rows, [theirs.entries, days]);
  const extra = useMemo(
    () => [...added, ...theirRows.filter((r) => r.key !== "(no job)").map((r) => ({ key: r.key, label: r.label }))],
    [added, theirRows],
  );

  const myTypes = users.find((u) => u.id === myId)?.types?.map((t) => t.name) ?? orgTypes;
  const ctx: NewEntryCtx = {
    myId,
    myName: mine.name || users.find((u) => u.id === myId)?.name || "",
    payTypes: myTypes,
    payHint: myEntries.find((e) => e.payType)?.payType ?? "",
    costHint: (jobId) => [...myEntries, ...theirs.entries].find((e) => e.jobId === jobId && e.costItemId)?.costItemId ?? "",
    startHint: (day) =>
      myEntries
        .filter((e) => e.date === day && e.endTime)
        .map((e) => e.endTime)
        .sort()
        .pop() ?? "07:00",
    onCreated: (e) => {
      setPending((p) => [...p, e]);
      // The JobTread write finishes after the answer (Apps Script log first),
      // so look twice rather than once.
      setTimeout(() => loadMine(true), 5000);
      setTimeout(() => loadMine(true), 15000);
    },
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Previous week" onClick={() => setWeek((w) => addDays(w, -7))}>
          ‹
        </IconButton>
        <span className="min-w-40 text-center text-sm font-bold tabular-nums">
          {shortDay(days[0])} – {shortDay(days[6])}, {days[6].slice(0, 4)}
        </span>
        <IconButton label="Next week" onClick={() => setWeek((w) => addDays(w, 7))}>
          ›
        </IconButton>
        <Button variant="secondary" size="sm" onClick={() => setWeek(weekStart(orgToday()))}>
          This week
        </Button>
        <Select
          aria-label="Employee to compare"
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          className="min-h-11 sm:ml-auto sm:w-64"
        >
          <option value="">Compare with…</option>
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <WeekSheet
            key={`mine-${week}`}
            title={mine.name || "My time"}
            side={{ ...mine, entries: myEntries }}
            days={days}
            extra={extra}
            panel={(row, day, list) => (
              <>
                {list.map((e) =>
                  e.pending || e.open ? (
                    <ReadEntry key={e.id} e={e} />
                  ) : (
                    <EntryEditor key={e.id} e={e} label={row.label} onSaved={() => loadMine(true)} />
                  ),
                )}
                {row.key !== "(no job)" && (
                  <NewEntry key={`${row.key}-${day}`} jobId={row.key} label={row.label} day={day} open={!list.length} ctx={ctx} />
                )}
              </>
            )}
          />
          <div className="max-w-xs">
            <JobPicker
              value=""
              onChange={() => {}}
              onSelect={(j) => {
                if (j && !added.some((a) => a.key === j.id))
                  setAdded((a) => [...a, { key: j.id, label: rowLabel({ customer: j.customer ?? "", jobName: j.name }) }]);
              }}
              jobs={jobs}
              includeAll={false}
              placeholder="+ Add customer"
            />
          </div>
        </div>
        {otherId ? (
          <WeekSheet
            key={`theirs-${otherId}-${week}`}
            title={theirs.name || "Employee"}
            side={theirs}
            days={days}
            panel={(_row, _day, list) =>
              list.length ? list.map((e) => <ReadEntry key={e.id} e={e} />) : <p className="text-sm text-neutral-500">No time here.</p>
            }
          />
        ) : (
          <Card className="flex items-center justify-center text-sm text-neutral-500">
            Pick an employee to see their week beside yours.
          </Card>
        )}
      </div>
    </div>
  );
}

function WeekSheet({
  title,
  side,
  days,
  extra,
  panel,
}: {
  title: string;
  side: Side;
  days: string[];
  extra?: { key: string; label: string }[];
  panel: (row: GridRow<Entry>, day: string, list: Entry[]) => React.ReactNode;
}) {
  const [sel, setSel] = useState<{ row: string; day: string } | null>(null);
  const grid = useMemo(() => buildGrid(side.entries, days, extra), [side.entries, days, extra]);
  const picked = sel ? grid.rows.find((r) => r.key === sel.row) : undefined;
  const cell = "border-l border-line-soft";

  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-sm font-bold">{title}</h2>
      {side.err && <Banner tone="error">{side.err}</Banner>}
      <Card pad={false} className="overflow-x-auto">
        {side.loading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : (
          <table className="w-full min-w-[38rem] border-collapse text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-line text-neutral-500">
                <th className="px-2.5 py-2 text-left font-semibold">Customer</th>
                {days.map((d) => (
                  <th key={d} className={`${cell} px-2 py-2 text-right font-semibold`}>
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" })}
                    <span className="block font-normal">{d.slice(5).replace("-", "/")}</span>
                  </th>
                ))}
                <th className={`${cell} px-2.5 py-2 text-right font-semibold`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {grid.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-5 text-center text-neutral-500">
                    No time this week.
                  </td>
                </tr>
              )}
              {grid.rows.map((r) => (
                <tr key={r.key}>
                  <td
                    className={`max-w-[12rem] px-2.5 py-2 text-left leading-snug ${
                      r.ghost ? "italic text-neutral-400 dark:text-neutral-500" : ""
                    }`}
                  >
                    {r.label}
                  </td>
                  {days.map((d) => {
                    const list = r.cells.get(d);
                    const min = list?.reduce((s, e) => s + e.minutes, 0) ?? 0;
                    const on = sel?.row === r.key && sel.day === d;
                    return (
                      <td key={d} className={`${cell} p-0`}>
                        <button
                          type="button"
                          onClick={() => setSel(on ? null : { row: r.key, day: d })}
                          className={`h-full min-h-12 w-full px-2 py-2 text-right ${
                            on ? "bg-accent/15 font-bold ring-2 ring-inset ring-accent" : "hover:bg-neutral-100 dark:hover:bg-white/5"
                          }`}
                        >
                          {fmtClock(min)}
                          {list?.some((e) => e.open || e.pending) && <span title="Still clocked in, or still saving"> •</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className={`${cell} px-2.5 py-2 text-right font-semibold`}>{fmtClock(r.minutes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-neutral-100 font-bold dark:bg-white/5">
                <td className="px-2.5 py-2.5 text-left">Totals</td>
                {days.map((d) => (
                  <td key={d} className={`${cell} px-2 py-2.5 text-right`}>
                    {fmtClock(grid.dayMinutes.get(d) ?? 0) || "0:00"}
                  </td>
                ))}
                <td className={`${cell} px-2.5 py-2.5 text-right`}>{fmtClock(grid.total) || "0:00"}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {sel && picked && !side.loading && (
        <Card className="space-y-3">
          <p className="text-xs font-semibold text-neutral-500">
            {picked.label} · {shortDay(sel.day)}
          </p>
          {panel(picked, sel.day, picked.cells.get(sel.day) ?? [])}
        </Card>
      )}
    </section>
  );
}

function ReadEntry({ e }: { e: Entry }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs text-neutral-500">
        {e.costCode} · {e.startTime}–{e.endTime || "now"} · {fmtClock(e.minutes) || "open"}
        {e.pending && " · saving to JobTread…"}
      </p>
      <p className="whitespace-pre-wrap">{e.notes || "No note."}</p>
    </div>
  );
}

/** Hours and note for one of your own entries. The start stays; the stop moves. */
function EntryEditor({ e, label, onSaved }: { e: Entry; label: string; onSaved?: () => void }) {
  const [hours, setHours] = useState(fmtClock(e.minutes));
  const [note, setNote] = useState(e.notes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    const min = parseHours(hours);
    if (min === null) return setMsg("Hours must look like 2:30 or 2.5.");
    if (!note.trim()) return setMsg("A note is required.");
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "edit",
          entryId: e.id,
          jobId: e.jobId,
          jobLabel: label,
          costItemId: e.costItemId,
          costCode: e.costCode,
          startTime: `${e.date}T${e.startTime}`,
          // An untouched hours field keeps the real stop: JobTread's minutes
          // can sit under the span (a break), and saving a note must not
          // quietly stretch the entry back to it.
          endTime: min === e.minutes ? originalEnd(e) : endAfter(e.date, e.startTime, min),
          note: note.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) return setMsg(j.error || "Could not save.");
      if (j.previewed) return setMsg("Writes are off on this deployment — nothing was changed in JobTread.");
      onSaved?.();
    } catch {
      setMsg("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = hours !== fmtClock(e.minutes) || note !== e.notes;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="flex-1">
          {e.costCode} · starts {e.startTime}
          {e.approved && " · approved"}
        </span>
        <QuietInput
          aria-label="Hours"
          inputMode="decimal"
          value={hours}
          onChange={(ev) => setHours(ev.target.value)}
          className="w-20 text-right tabular-nums"
        />
      </div>
      <Textarea aria-label="Note" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
      {msg && <p className="text-xs text-red-700 dark:text-red-400">{msg}</p>}
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setHours(fmtClock(e.minutes));
              setNote(e.notes);
              setMsg("");
            }}
          >
            Reset
          </Button>
          <Button size="sm" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

interface NewEntryCtx {
  myId: string;
  myName: string;
  payTypes: string[];
  payHint: string;
  costHint: (jobId: string) => string;
  startHint: (day: string) => string;
  onCreated: (e: Entry) => void;
}

// One cost-code read per job per visit, shared by every cell on that row.
const costCache = new Map<string, Promise<CostItem[]>>();
function loadCosts(jobId: string): Promise<CostItem[]> {
  let p = costCache.get(jobId);
  if (!p) {
    p = fetch(`/api/employee-time?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => (j.ok === false ? [] : (j.costItems ?? [])))
      .catch(() => []);
    costCache.set(jobId, p);
    p.then((items) => items.length || costCache.delete(jobId)); // retry an empty answer next time
  }
  return p;
}

/** A new entry in one cell of your own side — the Log-a-range write, from the grid. */
function NewEntry({
  jobId,
  label,
  day,
  open: startOpen,
  ctx,
}: {
  jobId: string;
  label: string;
  day: string;
  open: boolean;
  ctx: NewEntryCtx;
}) {
  const [open, setOpen] = useState(startOpen);
  const [costs, setCosts] = useState<CostItem[] | null>(null);
  const [costItemId, setCostItemId] = useState("");
  const [payType, setPayType] = useState(ctx.payTypes.includes(ctx.payHint) ? ctx.payHint : (ctx.payTypes[0] ?? ""));
  const [start, setStart] = useState(() => ctx.startHint(day));
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // One key per logical entry, so a retry after a dropped answer is one row.
  const keyRef = useRef("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCosts(jobId).then((items) => {
      if (!alive) return;
      setCosts(items);
      const hint = ctx.costHint(jobId);
      setCostItemId((cur) => cur || (items.some((c) => c.id === hint) ? hint : items.length === 1 ? items[0].id : ""));
    });
    return () => {
      alive = false;
    };
    // ctx is rebuilt every render; the hint is read once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId]);

  if (!open) {
    return (
      <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setOpen(true)}>
        + Add time
      </button>
    );
  }

  async function save() {
    const min = parseHours(hours);
    const cost = costs?.find((c) => c.id === costItemId);
    if (!cost) return setMsg("Pick a cost code.");
    if (!/^\d{2}:\d{2}$/.test(start)) return setMsg("Enter a start time.");
    if (min === null) return setMsg("Hours must look like 2:30 or 2.5.");
    if (!note.trim()) return setMsg("A note is required.");
    setBusy(true);
    setMsg("");
    keyRef.current ||= `te-${crypto.randomUUID()}`;
    const endTime = endAfter(day, start, min);
    try {
      const res = await fetch("/api/employee-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: keyRef.current,
          userId: ctx.myId,
          employee: ctx.myName,
          jobId,
          jobLabel: label,
          costItemId,
          costCode: cost.number,
          payType,
          startTime: `${day}T${start}`,
          endTime,
          note: note.trim(),
          photos: [],
        }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) return setMsg(j.error || "Could not save.");
      if (j.previewed) return setMsg("Writes are off on this deployment — logged, but not sent to JobTread.");
      const [customer, jobName] = label.includes(" › ") ? label.split(" › ") : ["", label];
      ctx.onCreated({
        id: keyRef.current,
        date: day,
        startTime: start,
        endTime: endTime.slice(11),
        minutes: min,
        jobId,
        jobName,
        customer,
        open: false,
        costItemId,
        costCode: cost.number,
        payType,
        notes: note.trim(),
        approved: false,
        pending: true,
      });
      keyRef.current = "";
      setHours("");
      setNote("");
      setOpen(false);
    } catch {
      setMsg("Couldn't reach the server — try Save again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold text-neutral-500">New entry</p>
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label="Cost code"
          value={costItemId}
          onChange={(e) => setCostItemId(e.target.value)}
          className="min-w-0 flex-1 basis-48"
          disabled={!costs}
        >
          <option value="">{costs ? "Cost code…" : "Loading cost codes…"}</option>
          {costs?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.number} — {c.name}
              {c.detail ? ` (${c.detail})` : ""}
            </option>
          ))}
        </Select>
        {ctx.payTypes.length > 1 && (
          <Select aria-label="Pay type" value={payType} onChange={(e) => setPayType(e.target.value)} className="w-auto">
            {ctx.payTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <label className="flex items-center gap-1.5">
          Start
          <input
            type="time"
            aria-label="Start time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={`${quietInputCls} w-28 tabular-nums`}
          />
        </label>
        <label className="ml-auto flex items-center gap-1.5">
          Hours
          <QuietInput
            aria-label="Hours"
            inputMode="decimal"
            placeholder="2:30"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-20 text-right tabular-nums"
          />
        </label>
      </div>
      <Textarea aria-label="Note" rows={3} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      {msg && <p className="text-xs text-red-700 dark:text-red-400">{msg}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
