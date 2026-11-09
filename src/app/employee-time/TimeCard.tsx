"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { jobLabel, type JobRef } from "@/components/JobPicker";
import { Banner, Button, IconButton, Label, Loading, Select, Textarea, tableCls } from "@/components/ui";
import { addDays, shortDay, weekStart } from "@/lib/timeEntryDates";
import { orgDay } from "@/lib/orgTime";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  PAY_TYPE_CHANGE_WARNING,
  defaultCostCode,
  matchPayType,
  type CostCodeDefault,
  type PayTypeRule,
} from "@/lib/payTypeMatch";
import { loadCosts, type CostItem } from "./WeekCompare";
import {
  buildCardRows,
  cardKey,
  endAfter,
  fmtClock,
  originalEnd,
  parseHours,
  rowLabel,
  stackStart,
  type CardEntry,
} from "./weekGrid";

/**
 * TIME CARD — the desktop Time Clock tab's second view, laid out like the
 * TSheets manual time card the office knows: the week across, one row per job
 * and cost code, hours typed straight into the day's cell, the selected row's
 * Work and Pay type below the grid on the left, the selected cell's Notes on
 * the right.
 *
 * What differs from TSheets, and why:
 *  - A row is a job AND a cost code. JobTread holds one cost code per entry,
 *    so a typed number must land on exactly one.
 *  - Changes are held until Save. Every JobTread entry needs a note, so a cell
 *    cannot save the moment its hours are typed.
 *  - Typed hours need a clock time. A new entry starts after the day's last
 *    stop (07:00 on an empty day), so it never overlaps logged time
 *    (weekGrid.stackStart). An edited entry keeps its start; its stop moves.
 *  - A cell holding two or more entries, a running clock, an approved entry or
 *    one still saving is read-only here. The Timesheets tab edits those.
 *
 * Every write is one Split View already makes: a new entry is the Log-a-range
 * POST /api/employee-time, an edit is `op: "edit"`, a cleared cell is
 * `op: "delete"` (both with the server's own-entry check). The signed-in
 * person's own time only — the page hides this view while acting.
 */

interface Entry extends CardEntry {
  payType: string;
  notes: string;
  approved: boolean;
  /** Sent, not yet read back from JobTread (the create is detached). */
  pending?: boolean;
}

/** A row added by hand: a job picked in a blank row, and then its Work. */
interface AddedRow {
  id: string;
  jobId: string;
  costItemId: string;
  label: string;
  work: string;
}

interface Row {
  id: string;
  jobId: string;
  costItemId: string;
  label: string;
  work: string;
  added: boolean;
  cells: Map<string, Entry[]>;
}

type Op =
  | { kind: "create"; cell: string; row: Row; day: string; text: string; note: string }
  | { kind: "edit"; cell: string; row: Row; day: string; e: Entry; text: string | undefined; note: string | undefined }
  | { kind: "delete"; cell: string; row: Row; day: string; e: Entry };

const BLANK_ROWS = 2;
const orgToday = () => orgDay(new Date().toISOString());
const cellId = (rowId: string, day: string) => `${rowId}@${day}`;
const isClear = (t: string) => /^\s*(0+(:00)?|0*\.0*)?\s*$/.test(t);

/** Why a cell can't be typed into, or "" when it can. */
function lockOf(row: Row, list: Entry[]): string {
  if (list.length > 1) return "This day has several entries. Edit them on the Timesheets tab.";
  const e = list[0];
  if (e?.pending) return "Still saving to JobTread.";
  if (e?.open) return "Still clocked in.";
  if (e?.approved) return "Approved — payroll has read it.";
  if (row.added && !row.costItemId) return "Pick the Work for this row first.";
  return "";
}

export function TimeCard({
  myId,
  myName,
  jobs,
  payTypes,
  payRules,
  codeDefaults,
}: {
  myId: string;
  myName: string;
  /** The time clock's job list — the jobs this person is added to. */
  jobs: JobRef[];
  payTypes: string[];
  payRules: PayTypeRule[];
  codeDefaults: CostCodeDefault[];
}) {
  const [week, setWeek] = useState(() => weekStart(orgToday()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [added, setAdded] = useState<AddedRow[]>([]);
  const [hours, setHours] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rowPay, setRowPay] = useState<Record<string, string>>({});
  const [cellErr, setCellErr] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<{ row: string; day: string } | null>(null);
  const [costs, setCosts] = useState<Record<string, CostItem[]>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "warning"; text: string } | null>(null);
  // One idempotency key per new cell, so a retry after a dropped answer is one row.
  const keys = useRef<Record<string, string>>({});
  const addedSeq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(`/api/employee-time/history?start=${days[0]}&end=${days[6]}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || j.ok === false) setLoadErr(j.error || "Could not load the week.");
        else {
          setEntries(j.entries ?? []);
          setLoadErr("");
        }
      } catch {
        setLoadErr("Couldn't reach the server.");
      } finally {
        setLoading(false);
      }
    },
    [days],
  );
  useEffect(() => {
    load();
  }, [load]);

  // A new entry shows at once, then gives way to JobTread's copy (same job,
  // code, day and start).
  const allEntries = useMemo(
    () => [
      ...entries,
      ...pending.filter(
        (p) =>
          !entries.some(
            (e) =>
              e.jobId === p.jobId && e.costItemId === p.costItemId && e.date === p.date && e.startTime === p.startTime,
          ),
      ),
    ],
    [entries, pending],
  );

  const rows: Row[] = useMemo(() => {
    const fromEntries: Row[] = buildCardRows(allEntries, days).map((r) => ({
      id: r.key,
      jobId: r.jobId,
      costItemId: r.costItemId,
      label: r.label,
      work: r.work,
      added: false,
      cells: r.cells,
    }));
    const have = new Set(fromEntries.map((r) => r.id));
    const extra: Row[] = added
      // Once saved, its entries give it a real row.
      .filter((a) => !a.costItemId || !have.has(cardKey(a.jobId, a.costItemId)))
      .map((a) => ({ ...a, added: true, cells: new Map() }));
    return [...fromEntries, ...extra];
  }, [allEntries, days, added]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // ------------------------------------------------------------ the changes
  const ops: Op[] = useMemo(() => {
    const out: Op[] = [];
    for (const row of rows) {
      for (const day of days) {
        const cell = cellId(row.id, day);
        const list = row.cells.get(day) ?? [];
        if (lockOf(row, list)) continue;
        const text = hours[cell];
        const note = notes[cell];
        const e = list[0];
        if (!e) {
          if (text !== undefined && !isClear(text)) out.push({ kind: "create", cell, row, day, text, note: note ?? "" });
          continue;
        }
        if (text !== undefined && isClear(text)) {
          out.push({ kind: "delete", cell, row, day, e });
          continue;
        }
        const hoursChanged = text !== undefined && parseHours(text) !== e.minutes;
        const noteChanged = note !== undefined && note.trim() !== e.notes.trim();
        if (hoursChanged || noteChanged) {
          out.push({
            kind: "edit",
            cell,
            row,
            day,
            e,
            text: hoursChanged ? text : undefined,
            note: noteChanged ? note : undefined,
          });
        }
      }
    }
    return out;
  }, [rows, days, hours, notes]);
  const dirty = ops.length > 0;
  useUnsavedChanges(dirty, "You have unsaved hours on your time card. Leave without saving?");
  const changed = useMemo(() => new Set(ops.map((o) => o.cell)), [ops]);

  // Minutes a cell counts for — the typed hours when they read, else JobTread's.
  function cellMinutes(row: Row, day: string): number {
    const text = hours[cellId(row.id, day)];
    if (text !== undefined) return isClear(text) ? 0 : (parseHours(text) ?? 0);
    return (row.cells.get(day) ?? []).reduce((s, e) => s + e.minutes, 0);
  }

  function discard() {
    setHours({});
    setNotes({});
    setCellErr({});
    setMsg(null);
  }

  function goWeek(next: string) {
    if (dirty && !confirm("Discard the hours you have not saved?")) return;
    discard();
    setAdded([]);
    setSel(null);
    setPending([]);
    setWeek(next);
  }

  // ------------------------------------------------------------- the rows
  const payHint = useMemo(
    () => [...allEntries].reverse().find((e) => e.payType && payTypes.includes(e.payType))?.payType ?? "",
    [allEntries, payTypes],
  );
  function payFor(row: Row): string {
    const chosen = rowPay[row.id];
    if (chosen) return chosen;
    const code = costs[row.jobId]?.find((c) => c.id === row.costItemId)?.number ?? row.work.split(" — ")[0];
    const ruled = matchPayType(payRules, { jtUserId: myId, jobId: row.jobId, costCode: code });
    if (ruled && payTypes.includes(ruled)) return ruled;
    return payHint || payTypes[0] || "";
  }

  function ensureCosts(jobId: string): Promise<CostItem[]> {
    return loadCosts(jobId).then((items) => {
      setCosts((c) => ({ ...c, [jobId]: items }));
      return items;
    });
  }

  function addRow(jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const id = `new-${++addedSeq.current}`;
    const label = rowLabel({ customer: job.customer ?? "", jobName: job.name });
    setAdded((a) => [...a, { id, jobId, costItemId: "", label, work: "" }]);
    const today = orgToday();
    setSel({ row: id, day: days.includes(today) ? today : days[0] });
    ensureCosts(jobId).then((items) => {
      // The office's default code for this person on this job, if any.
      const code = defaultCostCode(codeDefaults, { jtUserId: myId, jobId });
      const hit = code ? items.find((c) => c.number === code) : undefined;
      if (hit) pickWork(id, jobId, hit, items);
    });
  }

  function pickWork(rowId: string, jobId: string, item: CostItem | undefined, items?: CostItem[]) {
    if (item && rows.some((r) => !r.added && r.jobId === jobId && r.costItemId === item.id)) {
      setMsg({ tone: "warning", text: "That job and work already has a row. Type into it instead." });
      return;
    }
    const work = item ? `${item.number} — ${item.name}` : "";
    setAdded((a) => a.map((x) => (x.id === rowId ? { ...x, costItemId: item?.id ?? "", work } : x)));
    if (items) setCosts((c) => ({ ...c, [jobId]: items }));
    setMsg(null);
  }

  function removeRow(rowId: string) {
    setAdded((a) => a.filter((x) => x.id !== rowId));
    const drop = (m: Record<string, string>) =>
      Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${rowId}@`)));
    setHours(drop);
    setNotes(drop);
    if (sel?.row === rowId) setSel(null);
  }

  // ------------------------------------------------------------------ save
  async function save() {
    if (!ops.length || saving) return;
    const errs: Record<string, string> = {};
    // New entries stack after the day's last stop, in row order — the stops
    // as THIS save leaves them: deleted entries gone, edited hours applied.
    const queued: { date: string; start: string; minutes: number }[] = [];
    const gone = new Set(ops.flatMap((o) => (o.kind === "delete" ? [o.e.id] : [])));
    const newEnd = new Map<string, string>();
    for (const o of ops) {
      const m = o.kind === "edit" && o.text !== undefined ? parseHours(o.text) : null;
      if (o.kind === "edit" && m !== null) newEnd.set(o.e.id, endAfter(o.e.date, o.e.startTime, m).slice(11));
    }
    const stops = allEntries
      .filter((e) => !gone.has(e.id))
      .map((e) => (newEnd.has(e.id) ? { ...e, endTime: newEnd.get(e.id)! } : e));
    const plan: { op: Op; body: Record<string, unknown>; url: string; minutes?: number; start?: string }[] = [];
    for (const op of ops) {
      if (op.kind === "delete") {
        plan.push({ op, url: "/api/employee-time/clock", body: { op: "delete", entryId: op.e.id } });
        continue;
      }
      const note = (op.kind === "create" ? op.note : (op.note ?? op.e.notes)).trim();
      if (op.kind === "create") {
        const min = parseHours(op.text);
        if (min === null) {
          errs[op.cell] = "Hours must look like 2:30 or 2.5.";
          continue;
        }
        if (!note) {
          errs[op.cell] = "A note is required.";
          continue;
        }
        const start = stackStart(op.day, min, stops, queued);
        if (!start) {
          errs[op.cell] = "Too many hours for this day — they would run past midnight.";
          continue;
        }
        queued.push({ date: op.day, start, minutes: min });
        const code = costs[op.row.jobId]?.find((c) => c.id === op.row.costItemId)?.number ?? op.row.work.split(" — ")[0];
        keys.current[op.cell] ||= `te-${crypto.randomUUID()}`;
        plan.push({
          op,
          url: "/api/employee-time",
          minutes: min,
          start,
          body: {
            clientKey: keys.current[op.cell],
            userId: myId,
            employee: myName,
            jobId: op.row.jobId,
            jobLabel: op.row.label,
            costItemId: op.row.costItemId,
            costCode: code,
            payType: payFor(op.row),
            startTime: `${op.day}T${start}`,
            endTime: endAfter(op.day, start, min),
            note,
            photos: [],
          },
        });
        continue;
      }
      // edit
      const min = op.text !== undefined ? parseHours(op.text) : op.e.minutes;
      if (min === null) {
        errs[op.cell] = "Hours must look like 2:30 or 2.5.";
        continue;
      }
      if (!note) {
        errs[op.cell] = "A note is required.";
        continue;
      }
      const end = op.text !== undefined ? endAfter(op.e.date, op.e.startTime, min) : originalEnd(op.e);
      plan.push({
        op,
        url: "/api/employee-time/clock",
        body: {
          op: "edit",
          entryId: op.e.id,
          jobId: op.e.jobId,
          jobLabel: op.row.label,
          costItemId: op.e.costItemId,
          costCode: op.e.costCode,
          startTime: `${op.e.date}T${op.e.startTime}`,
          // Untouched hours keep the real stop: JobTread's minutes can sit
          // under the span (a break), and a note edit must not stretch it.
          endTime: end,
          note,
        },
      });
    }
    setCellErr(errs);
    const firstErr = Object.keys(errs)[0];
    if (firstErr) {
      const [row, day] = firstErr.split("@");
      setSel({ row, day });
      setMsg({ tone: "error", text: `Fix ${Object.keys(errs).length === 1 ? "the cell" : `${Object.keys(errs).length} cells`} marked in red, then Save again.` });
      return;
    }
    const deletes = plan.filter((p) => p.op.kind === "delete").length;
    if (deletes && !confirm(`Delete ${deletes} ${deletes === 1 ? "entry" : "entries"} from JobTread? This cannot be undone.`))
      return;

    setSaving(true);
    setMsg(null);
    const failed: Record<string, string> = {};
    const created: Entry[] = [];
    let previewed = false;
    for (const p of plan) {
      try {
        const res = await fetch(p.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p.body),
        });
        const j = await res.json();
        if (!res.ok || j.ok === false) {
          failed[p.op.cell] = j.error || "Could not save.";
          continue;
        }
        if (j.previewed) previewed = true;
        if (p.op.kind === "create" && !j.previewed) {
          const [customer, jobName] = p.op.row.label.includes(" › ") ? p.op.row.label.split(" › ") : ["", p.op.row.label];
          created.push({
            id: keys.current[p.op.cell],
            date: p.op.day,
            startTime: p.start!,
            endTime: endAfter(p.op.day, p.start!, p.minutes!).slice(11),
            minutes: p.minutes!,
            jobId: p.op.row.jobId,
            jobName,
            customer,
            open: false,
            costItemId: p.op.row.costItemId,
            costCode: String(p.body.costCode ?? ""),
            costItemName: p.op.row.work.split(" — ")[1] ?? "",
            payType: String(p.body.payType ?? ""),
            notes: String(p.body.note ?? ""),
            approved: false,
            pending: true,
          });
        }
        delete keys.current[p.op.cell];
      } catch {
        failed[p.op.cell] = "Couldn't reach the server — Save again.";
      }
    }
    // Keep only what failed, so Save retries exactly that.
    const keep = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => k in failed));
    setHours(keep);
    setNotes(keep);
    setCellErr(failed);
    if (created.length) setPending((x) => [...x, ...created]);
    setSaving(false);
    const nFail = Object.keys(failed).length;
    setMsg(
      nFail
        ? { tone: "error", text: `${plan.length - nFail} saved, ${nFail} did not. The cells marked in red say why.` }
        : previewed
          ? { tone: "warning", text: "Writes are off on this deployment — nothing was changed in JobTread." }
          : { tone: "success", text: `Saved ${plan.length} ${plan.length === 1 ? "change" : "changes"}.` },
    );
    load(true);
    // A new entry reaches JobTread a few seconds after the answer; look twice.
    if (created.length) {
      setTimeout(() => load(true), 5000);
      setTimeout(() => load(true), 15000);
    }
  }

  // ------------------------------------------------------------ the screen
  const picked = sel ? rowById.get(sel.row) : undefined;
  const pickedList = picked && sel ? (picked.cells.get(sel.day) ?? []) : [];
  const pickedCell = picked && sel ? cellId(picked.id, sel.day) : "";
  const pickedLock = picked ? lockOf(picked, pickedList) : "";
  const pickedHasTime = picked && sel ? cellMinutes(picked, sel.day) > 0 : false;
  const usedJobs = new Set(rows.map((r) => r.jobId));
  const today = orgToday();
  const dayTotals = days.map((d) => rows.reduce((s, r) => s + cellMinutes(r, d), 0));
  const total = dayTotals.reduce((a, b) => a + b, 0);
  const col = "border-l border-line-soft";

  // Enter moves down the day's column, the way a spreadsheet does.
  function onCellKey(ev: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, dayIdx: number) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`[data-card-cell="${rowIdx + 1}-${dayIdx}"]`);
    if (next) next.focus();
    else (ev.target as HTMLInputElement).blur();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => goWeek(weekStart(today))}>
          Today
        </Button>
        <IconButton label="Previous week" onClick={() => goWeek(addDays(week, -7))}>
          ‹
        </IconButton>
        <IconButton label="Next week" onClick={() => goWeek(addDays(week, 7))}>
          ›
        </IconButton>
        <span className="text-sm font-bold tabular-nums">
          {shortDay(days[0])} – {shortDay(days[6])}, {days[6].slice(0, 4)}
        </span>
        <span className="flex-1" />
        {dirty && (
          <span className="text-xs text-neutral-500">
            {ops.length} unsaved {ops.length === 1 ? "change" : "changes"}
          </span>
        )}
        <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={discard}>
          Discard
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {loadErr && <Banner tone="error">{loadErr}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-ink-raised">
        {loading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : (
          <table className={`${tableCls.root} min-w-[52rem] tabular-nums`}>
            <thead>
              <tr>
                <th className="w-8 border-b border-line" aria-label="Remove row" />
                <th className={tableCls.th}>Customer · Work</th>
                {days.map((d) => (
                  <th
                    key={d}
                    className={`${col} ${tableCls.thNum} ${d === today ? "bg-accent/10" : ""}`}
                  >
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}
                    <span className="block font-normal normal-case">{d.slice(5).replace("-", "/")}</span>
                  </th>
                ))}
                <th className={`${col} ${tableCls.thNum}`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                const rowMin = days.reduce((s, d) => s + cellMinutes(r, d), 0);
                const rowSel = sel?.row === r.id;
                return (
                  <tr key={r.id} className={`${tableCls.tr} ${rowSel ? "bg-neutral-50 dark:bg-white/[0.03]" : ""}`}>
                    <td className="px-1 text-center align-middle">
                      {r.added && (
                        <button
                          type="button"
                          aria-label={`Remove the ${r.label} row`}
                          title="Remove this row"
                          onClick={() => removeRow(r.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-danger hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          ×
                        </button>
                      )}
                    </td>
                    <td className="max-w-[16rem] px-3 py-1.5 align-middle leading-snug">
                      <button
                        type="button"
                        onClick={() => setSel({ row: r.id, day: sel?.day ?? (days.includes(today) ? today : days[0]) })}
                        className="block w-full text-left"
                      >
                        <span className="block font-semibold text-accent dark:text-accent-soft">{r.label}</span>
                        <span className={`block text-xs ${r.work ? "text-neutral-500" : "text-warn"}`}>
                          {r.work || "Pick the Work below"}
                        </span>
                      </button>
                    </td>
                    {days.map((d, di) => {
                      const list = r.cells.get(d) ?? [];
                      const lock = lockOf(r, list);
                      const cell = cellId(r.id, d);
                      const on = sel?.row === r.id && sel.day === d;
                      const err = cellErr[cell];
                      const value = hours[cell] ?? fmtClock(list.reduce((s, e) => s + e.minutes, 0));
                      const ring = err
                        ? "ring-2 ring-inset ring-danger"
                        : on
                          ? "ring-2 ring-inset ring-accent"
                          : "";
                      const tint = changed.has(cell) ? "bg-accent/10" : d === today ? "bg-accent/[0.04]" : "";
                      return (
                        <td key={d} className={`${col} p-0 ${tint}`}>
                          {lock ? (
                            <button
                              type="button"
                              title={lock}
                              onClick={() => setSel({ row: r.id, day: d })}
                              className={`h-full min-h-11 w-full px-2 text-right text-neutral-500 ${ring}`}
                            >
                              {value}
                              {list.some((e) => e.open || e.pending) && " •"}
                            </button>
                          ) : (
                            <input
                              aria-label={`${r.label}, ${r.work}, ${shortDay(d)} hours`}
                              title={err || undefined}
                              data-card-cell={`${ri}-${di}`}
                              inputMode="decimal"
                              value={value}
                              placeholder=""
                              onFocus={() => setSel({ row: r.id, day: d })}
                              onKeyDown={(ev) => onCellKey(ev, ri, di)}
                              onChange={(ev) => {
                                const v = ev.target.value;
                                setHours((h) => ({ ...h, [cell]: v }));
                                if (err) setCellErr((x) => ({ ...x, [cell]: "" }));
                              }}
                              className={`h-full min-h-11 w-full bg-transparent px-2 text-right focus:outline-none ${ring}`}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className={`${col} ${tableCls.tdNum} align-middle font-semibold`}>{fmtClock(rowMin) || "0:00"}</td>
                  </tr>
                );
              })}
              {Array.from({ length: BLANK_ROWS }, (_, i) => (
                <tr key={`blank-${i}`} className={tableCls.tr}>
                  <td />
                  <td className="px-3 py-1.5">
                    <Select
                      aria-label="Add a job"
                      value=""
                      onChange={(e) => e.target.value && addRow(e.target.value)}
                      className="text-neutral-500"
                    >
                      <option value="">{i === 0 ? "+ Add a job" : "(no job)"}</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {jobLabel(j)}
                          {usedJobs.has(j.id) ? " (another code)" : ""}
                        </option>
                      ))}
                    </Select>
                  </td>
                  {days.map((d) => (
                    <td key={d} className={`${col} min-h-11`} />
                  ))}
                  <td className={col} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={tableCls.foot}>
                <td />
                <td className={`${tableCls.td} text-right`}>Totals</td>
                {dayTotals.map((m, i) => (
                  <td key={days[i]} className={`${col} ${tableCls.tdNum}`}>
                    {fmtClock(m) || "0:00"}
                  </td>
                ))}
                <td className={`${col} ${tableCls.tdNum}`}>{fmtClock(total) || "0:00"}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {picked && sel && !loading && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
          {/* The selected ROW: what a new entry in it is filed as. */}
          <div className="space-y-2">
            <div>
              <Label>Job</Label>
              <p className="text-sm font-semibold">{picked.label}</p>
            </div>
            <div>
              <Label htmlFor="card-work">Work</Label>
              {picked.added ? (
                <Select
                  id="card-work"
                  value={picked.costItemId}
                  disabled={!costs[picked.jobId]}
                  onChange={(e) =>
                    pickWork(picked.id, picked.jobId, costs[picked.jobId]?.find((c) => c.id === e.target.value))
                  }
                >
                  <option value="">{costs[picked.jobId] ? "(required)" : "Loading…"}</option>
                  {costs[picked.jobId]?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number} — {c.name}
                      {c.detail && c.detail !== c.name ? ` (${c.detail})` : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm">{picked.work || "—"}</p>
              )}
            </div>
            {payTypes.length > 1 && (
              <div>
                <Label htmlFor="card-pay">Pay type for new hours</Label>
                <Select
                  id="card-pay"
                  value={payFor(picked)}
                  onChange={(e) => {
                    if (e.target.value !== payFor(picked) && !confirm(PAY_TYPE_CHANGE_WARNING)) return;
                    setRowPay((p) => ({ ...p, [picked.id]: e.target.value }));
                  }}
                >
                  {payTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* The selected CELL: its note. */}
          <div>
            <Label htmlFor="card-note">
              Notes: {picked.label} · {shortDay(sel.day)}
            </Label>
            {pickedList.length > 1 ? (
              <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3 text-sm">
                <p className="text-xs text-neutral-500">{pickedLock}</p>
                {pickedList.map((e) => (
                  <div key={e.id}>
                    <p className="text-xs text-neutral-500">
                      {e.startTime}–{e.endTime || "now"} · {fmtClock(e.minutes) || "open"}
                    </p>
                    <p className="whitespace-pre-wrap">{e.notes || "No note."}</p>
                  </div>
                ))}
              </div>
            ) : (
              <Textarea
                id="card-note"
                rows={4}
                disabled={!!pickedLock || !pickedHasTime}
                placeholder={pickedLock || "Enter time before adding notes to this entry."}
                value={notes[pickedCell] ?? pickedList[0]?.notes ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setNotes((n) => ({ ...n, [pickedCell]: v }));
                  if (cellErr[pickedCell]) setCellErr((x) => ({ ...x, [pickedCell]: "" }));
                }}
              />
            )}
            {cellErr[pickedCell] && <p className="mt-1 text-xs text-danger">{cellErr[pickedCell]}</p>}
            {pickedList[0] && pickedList.length === 1 && (
              <p className="mt-1 text-xs text-neutral-500">
                {pickedList[0].startTime}–{pickedList[0].endTime || "now"}
                {pickedList[0].payType ? ` · ${pickedList[0].payType}` : ""}
                {pickedList[0].approved ? " · approved" : ""}. Changing the hours moves the stop time.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
