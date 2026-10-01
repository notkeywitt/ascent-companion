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
}

/** "Kevin Berger › Bunkhouse", the way the reference sheet names a row. */
export function rowLabel(e: Pick<GridEntry, "customer" | "jobName">): string {
  const c = e.customer.trim();
  const j = e.jobName.trim();
  if (c && j && c !== j) return `${c} › ${j}`;
  return j || c || "(no job)";
}

export function buildGrid<E extends GridEntry>(entries: E[], days: string[]) {
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
