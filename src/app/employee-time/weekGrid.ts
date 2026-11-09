/**
 * The pure half of the week compare on /employee-time: one person's week of
 * time entries as a customer × day grid, and the hours arithmetic its cells
 * edit with. No React, so the unit suite can reach it.
 */

/** The fields of a timesheet row the grid reads. */
export interface GridEntry {
  id: string;
  date: string; // org-local "YYYY-MM-DD" of the start
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM", "" while open
  minutes: number;
  jobId: string;
  jobName: string;
  customer: string;
  open: boolean;
}

export interface GridRow<E extends GridEntry> {
  /** The job id — the same key on both sides, so a selection can mirror. */
  key: string;
  label: string;
  cells: Map<string, E[]>;
  minutes: number;
  /** A row with no time of yours yet: a customer you added, or one the other side has. */
  ghost?: boolean;
}

/** "Kevin Berger › Bunkhouse", the way the reference sheet names a row. */
export function rowLabel(e: Pick<GridEntry, "customer" | "jobName">): string {
  const c = e.customer.trim();
  const j = e.jobName.trim();
  if (c && j && c !== j) return `${c} › ${j}`;
  return j || c || "(no job)";
}

/**
 * `extra` adds empty "ghost" rows — a customer added by hand, or a row the
 * other person has — unless the entries already give that job a row.
 */
export function buildGrid<E extends GridEntry>(
  entries: E[],
  days: string[],
  extra: { key: string; label: string }[] = [],
) {
  const inWeek = new Set(days);
  const rows = new Map<string, GridRow<E>>();
  const dayMinutes = new Map<string, number>(days.map((d) => [d, 0]));
  let total = 0;
  for (const e of entries) {
    if (!inWeek.has(e.date)) continue;
    const key = e.jobId || "(no job)";
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { key, label: rowLabel(e), cells: new Map(), minutes: 0 }));
    const cell = row.cells.get(e.date);
    if (cell) cell.push(e);
    else row.cells.set(e.date, [e]);
    row.minutes += e.minutes;
    dayMinutes.set(e.date, (dayMinutes.get(e.date) ?? 0) + e.minutes);
    total += e.minutes;
  }
  for (const x of extra) {
    if (!rows.has(x.key)) rows.set(x.key, { key: x.key, label: x.label, cells: new Map(), minutes: 0, ghost: true });
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.label.localeCompare(b.label)),
    dayMinutes,
    total,
  };
}

/** 150 → "2:30", the sheet's own format. 0 → "". */
export function fmtClock(min: number): string {
  if (!min) return "";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** "2:30", "2.5" or "2" → minutes. null for anything else, or for zero. */
export function parseHours(s: string): number | null {
  const t = s.trim();
  let min: number;
  const hm = t.match(/^(\d{1,2}):([0-5]\d)$/);
  if (hm) min = Number(hm[1]) * 60 + Number(hm[2]);
  else if (/^\d{1,2}(\.\d+)?$|^\.\d+$/.test(t)) min = Math.round(Number(t) * 60);
  else return null;
  return min > 0 && min <= 24 * 60 ? min : null;
}

/** The wall-clock stop that gives `minutes` from the entry's start. */
export function endAfter(date: string, startTime: string, minutes: number): string {
  const t = new Date(`${date}T${startTime}:00Z`).getTime() + minutes * 60000;
  return new Date(t).toISOString().slice(0, 16);
}

/** The entry's existing stop, rolled to the next day when it crosses midnight. */
export function originalEnd(e: Pick<GridEntry, "date" | "startTime" | "endTime">): string {
  if (e.endTime > e.startTime) return `${e.date}T${e.endTime}`;
  const next = new Date(`${e.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T${e.endTime}`;
}

/* ── THE TIME CARD (TimeCard.tsx) ───────────────────────────────────────────
   The TSheets-style manual card on the Time Clock tab. A row is a job AND a
   cost code, not a job: a typed number has to land on exactly one cost code,
   and JobTread holds one per entry. */

/** The fields of an entry the time card reads, on top of the grid's. */
export interface CardEntry extends GridEntry {
  costItemId: string;
  costCode: string;
  costItemName?: string;
}

export interface CardRow<E extends CardEntry> {
  key: string;
  jobId: string;
  costItemId: string;
  label: string;
  /** "01 51 20 — Framing" */
  work: string;
  cells: Map<string, E[]>;
}

export const cardKey = (jobId: string, costItemId: string) => `${jobId}|${costItemId}`;

/** One row per job + cost code with time this week, sorted by job then code. */
export function buildCardRows<E extends CardEntry>(entries: E[], days: string[]): CardRow<E>[] {
  const inWeek = new Set(days);
  const rows = new Map<string, CardRow<E>>();
  for (const e of entries) {
    if (!inWeek.has(e.date)) continue;
    const key = cardKey(e.jobId, e.costItemId);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        jobId: e.jobId,
        costItemId: e.costItemId,
        label: rowLabel(e),
        work: [e.costCode, e.costItemName].filter(Boolean).join(" — "),
        cells: new Map(),
      };
      rows.set(key, row);
    }
    const cell = row.cells.get(e.date);
    if (cell) cell.push(e);
    else row.cells.set(e.date, [e]);
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label) || a.work.localeCompare(b.work));
}

/**
 * Where a new entry typed as hours starts: after the day's last stop, so it
 * never overlaps time already logged, else 07:00. `queued` holds the entries
 * the same save has already placed on that day, so two new cells stack.
 * "" when the hours would run past midnight.
 */
export function stackStart(
  day: string,
  minutes: number,
  existing: Pick<GridEntry, "date" | "startTime" | "endTime">[],
  queued: { date: string; start: string; minutes: number }[],
  fallback = "07:00",
): string {
  let last = "";
  for (const e of existing) {
    if (e.date !== day || !e.endTime) continue;
    const end = originalEnd(e);
    if (end.slice(0, 10) !== day) return ""; // already runs past midnight
    if (end.slice(11) > last) last = end.slice(11);
  }
  for (const q of queued) {
    if (q.date !== day) continue;
    const end = endAfter(day, q.start, q.minutes);
    if (end.slice(0, 10) !== day) return "";
    if (end.slice(11) > last) last = end.slice(11);
  }
  const start = last || fallback;
  return endAfter(day, start, minutes).slice(0, 10) === day ? start : "";
}
