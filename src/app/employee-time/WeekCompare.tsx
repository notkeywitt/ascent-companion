"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, IconButton, Loading, QuietInput, Select, Textarea } from "@/components/ui";
import { addDays, shortDay, weekStart } from "@/lib/timeEntryDates";
import { orgDay } from "@/lib/orgTime";
import { buildGrid, endAfter, fmtClock, originalEnd, parseHours, type GridEntry } from "./weekGrid";

/**
 * WEEK COMPARE — the office's two-windows-side-by-side habit, in one screen.
 * Left: the signed-in person's week. Right: the employee picked above it. Rows
 * are customer › job, columns the seven days, the same shape as the sheet the
 * office used to open twice.
 *
 * A cell is a selection, not an editor. Picking one opens that customer-day on
 * BOTH sides at once, so "what did Dan write for the Bunkhouse on Wednesday"
 * sits beside your own note for it. Your side edits hours and the note; theirs
 * only reads. The read goes through /api/employee-time/history with
 * `actingAs`, which the server allows for admin and office only.
 *
 * An edit is the Timesheets tab's own save (`op: "edit"`): same route, same
 * owner check, so nothing here can touch the other person's entry.
 */

interface Entry extends GridEntry {
  costItemId: string;
  costCode: string;
  notes: string;
  approved: boolean;
}

interface Side {
  entries: Entry[];
  loading: boolean;
  err: string;
  name: string;
}

const orgToday = () => orgDay(new Date().toISOString());

const EMPTY: Side = { entries: [], loading: false, err: "", name: "" };

export function WeekCompare({ users, myId }: { users: { id: string; name: string }[]; myId: string }) {
  const [week, setWeek] = useState(() => weekStart(orgToday()));
  const [otherId, setOtherId] = useState("");
  const [mine, setMine] = useState<Side>(EMPTY);
  const [theirs, setTheirs] = useState<Side>(EMPTY);
  const [sel, setSel] = useState<{ row: string; day: string } | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  const load = useCallback(
    async (actingAs: string, set: (s: Side) => void) => {
      set({ ...EMPTY, loading: true });
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

  const loadMine = useCallback(() => load("", setMine), [load]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);
  useEffect(() => {
    if (otherId) load(otherId, setTheirs);
    else setTheirs(EMPTY);
  }, [otherId, load]);

  const others = users.filter((u) => u.id !== myId).sort((a, b) => a.name.localeCompare(b.name));

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
        <WeekSheet title={mine.name || "My time"} side={mine} days={days} sel={sel} onSelect={setSel} editable onSaved={loadMine} />
        {otherId ? (
          <WeekSheet title={theirs.name || "Employee"} side={theirs} days={days} sel={sel} onSelect={setSel} />
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
  sel,
  onSelect,
  editable = false,
  onSaved,
}: {
  title: string;
  side: Side;
  days: string[];
  sel: { row: string; day: string } | null;
  onSelect: (s: { row: string; day: string } | null) => void;
  editable?: boolean;
  onSaved?: () => void;
}) {
  const grid = useMemo(() => buildGrid(side.entries, days), [side.entries, days]);
  const picked = sel ? grid.rows.find((r) => r.key === sel.row) : undefined;
  const cellEntries = sel && picked ? (picked.cells.get(sel.day) ?? []) : [];

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
          <table className="w-full min-w-[34rem] border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-line text-neutral-500">
                <th className="px-2 py-2 text-left font-semibold">Customer</th>
                {days.map((d) => (
                  <th key={d} className="px-1 py-2 text-right font-semibold">
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" })}
                    <span className="block font-normal">{d.slice(5).replace("-", "/")}</span>
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {grid.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-4 text-center text-neutral-500">
                    No time this week.
                  </td>
                </tr>
              )}
              {grid.rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-[11rem] px-2 py-1.5 text-left leading-snug">{r.label}</td>
                  {days.map((d) => {
                    const list = r.cells.get(d);
                    const min = list?.reduce((s, e) => s + e.minutes, 0) ?? 0;
                    const on = sel?.row === r.key && sel.day === d;
                    return (
                      <td key={d} className="p-0">
                        <button
                          type="button"
                          disabled={!list}
                          onClick={() => onSelect(on ? null : { row: r.key, day: d })}
                          className={`h-full min-h-9 w-full px-1 py-1.5 text-right ${
                            on ? "bg-accent/15 font-bold ring-2 ring-inset ring-accent" : list ? "hover:bg-neutral-100 dark:hover:bg-white/5" : ""
                          }`}
                        >
                          {fmtClock(min)}
                          {list?.some((e) => e.open) && <span title="Still clocked in"> •</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right font-semibold">{fmtClock(r.minutes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-bold">
                <td className="px-2 py-2 text-left">Totals</td>
                {days.map((d) => (
                  <td key={d} className="px-1 py-2 text-right">
                    {fmtClock(grid.dayMinutes.get(d) ?? 0) || "0:00"}
                  </td>
                ))}
                <td className="px-2 py-2 text-right">{fmtClock(grid.total) || "0:00"}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {sel && !side.loading && (
        <Card className="space-y-3">
          <p className="text-xs font-semibold text-neutral-500">
            {picked?.label ?? "Nothing on this customer"} · {shortDay(sel.day)}
          </p>
          {cellEntries.length === 0 && <p className="text-sm text-neutral-500">No time here.</p>}
          {cellEntries.map((e) =>
            editable && !e.open ? (
              <EntryEditor key={e.id} e={e} label={picked?.label ?? ""} onSaved={onSaved} />
            ) : (
              <div key={e.id} className="space-y-1 text-sm">
                <p className="text-xs text-neutral-500">
                  {e.costCode} · {e.startTime}–{e.endTime || "now"} · {fmtClock(e.minutes) || "open"}
                </p>
                <p className="whitespace-pre-wrap">{e.notes || "No note."}</p>
              </div>
            ),
          )}
        </Card>
      )}
    </section>
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
