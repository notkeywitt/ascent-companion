/**
 * Pure maths for Work Weave: crew hours laid on a day × hour grid.
 * No React, no DOM. Times are org-local strings, so every date sum here
 * runs in UTC and never shifts with the browser's zone.
 */
import type { ArtTimeRow } from "./rows";

export type WeaveRow = Pick<ArtTimeRow, "start" | "hours" | "person">;

/** The grid shows 5 AM up to 9 PM: sixteen one-hour rows. */
export const WEAVE_FIRST_HOUR = 5;
export const WEAVE_HOURS = 16;
/** Colours in the theme's categorical set. */
export const PALETTE_SIZE = 8;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The colour slot of the person at this rank in a total-hours ordering. */
export const personColor = (rank: number) => rank % PALETTE_SIZE;

/** Monday = 0 … Sunday = 6, from a day number counted from 1970-01-01. */
export const weekdayOf = (epochDay: number) => (((epochDay + 3) % 7) + 7) % 7;

/** "7 AM", "12 PM", "12 AM". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

export interface HourPiece {
  /** Day number counted from 1970-01-01. */
  day: number;
  /** Hour of day, 0..23. */
  hour: number;
  hours: number;
}

const START = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** Split one entry across every clock hour it covers. A bad start gives nothing. */
export function splitHours(start: string, hours: number): HourPiece[] {
  const m = START.exec(start);
  if (!m || !Number.isFinite(hours) || hours <= 0) return [];
  const from = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) / 60000;
  const end = from + Math.min(hours, 48) * 60;
  const out: HourPiece[] = [];
  let cur = from;
  while (cur < end - 1e-9) {
    const slot = Math.floor(cur / 60 + 1e-12);
    const next = Math.min(end, (slot + 1) * 60);
    const day = Math.floor(slot / 24);
    out.push({ day, hour: slot - day * 24, hours: (next - cur) / 60 });
    cur = next;
  }
  return out;
}

export interface WeaveGrid {
  /** Day number of the first column. */
  firstDay: number;
  days: number;
  /** "YYYY-MM-DD" of each column. */
  dates: string[];
  /** People by total hours, biggest first. Totals count every hour worked. */
  people: { name: string; total: number }[];
  /** Per person (same order as `people`): hours per cell, index = day * 16 + (hour - 5). */
  byPerson: Float64Array[];
  /** Hours per cell, everyone. */
  all: Float64Array;
  /** Per cell: index into `people` of the person with the most hours, or -1. */
  top: Int16Array;
  /** Hours inside the grid (the sum of `all`). */
  total: number;
}

const dateOf = (epochDay: number) => new Date(epochDay * 86_400_000).toISOString().slice(0, 10);

export function buildWeave(rows: readonly WeaveRow[]): WeaveGrid {
  const valid = rows.filter((r) => START.test(r.start) && r.hours > 0);
  if (!valid.length) {
    return { firstDay: 0, days: 0, dates: [], people: [], byPerson: [], all: new Float64Array(0), top: new Int16Array(0), total: 0 };
  }
  const dayOf = (s: string) => {
    const m = START.exec(s)!;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
  };
  let first = Infinity;
  let last = -Infinity;
  const totals = new Map<string, number>();
  for (const r of valid) {
    const d = dayOf(r.start);
    first = Math.min(first, d);
    last = Math.max(last, d);
    const name = r.person || "Unknown";
    totals.set(name, (totals.get(name) ?? 0) + r.hours);
  }
  const days = last - first + 1;
  const people = [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const rank = new Map(people.map((p, i) => [p.name, i]));
  const cells = days * WEAVE_HOURS;
  const byPerson = people.map(() => new Float64Array(cells));
  const all = new Float64Array(cells);
  for (const r of valid) {
    const grid = byPerson[rank.get(r.person || "Unknown")!];
    for (const p of splitHours(r.start, r.hours)) {
      const row = p.hour - WEAVE_FIRST_HOUR;
      const col = p.day - first;
      if (row < 0 || row >= WEAVE_HOURS || col < 0 || col >= days) continue;
      grid[col * WEAVE_HOURS + row] += p.hours;
      all[col * WEAVE_HOURS + row] += p.hours;
    }
  }
  const top = new Int16Array(cells).fill(-1);
  for (let i = 0; i < cells; i++) {
    let best = 0;
    for (let p = 0; p < byPerson.length; p++) {
      if (byPerson[p][i] > best) {
        best = byPerson[p][i];
        top[i] = p;
      }
    }
  }
  let total = 0;
  for (let i = 0; i < cells; i++) total += all[i];
  return {
    firstDay: first,
    days,
    dates: Array.from({ length: days }, (_, i) => dateOf(first + i)),
    people,
    byPerson,
    all,
    top,
    total,
  };
}

/**
 * What to draw for a selection: `v` is each cell's intensity 0..1 (square root
 * of its hours over the biggest cell), `c` its colour slot.
 */
export function weaveTarget(
  grid: WeaveGrid,
  person: number | null,
  byPersonColour: boolean,
): { v: Float32Array; c: Uint8Array } {
  const src = person === null ? grid.all : grid.byPerson[person];
  const n = src?.length ?? 0;
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, src[i]);
  const v = new Float32Array(n);
  const c = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    v[i] = max > 0 ? Math.sqrt(src[i] / max) : 0;
    const who = person === null ? grid.top[i] : person;
    c[i] = byPersonColour && who >= 0 ? personColor(who) : 0;
  }
  return { v, c };
}

/** Hours, busiest weekday (0 = Monday) and busiest hour of day for a selection. */
export function weaveStats(grid: WeaveGrid, person: number | null) {
  const src = person === null ? grid.all : grid.byPerson[person];
  const byWeekday = new Array<number>(7).fill(0);
  const byHour = new Array<number>(WEAVE_HOURS).fill(0);
  let total = 0;
  if (src) {
    for (let i = 0; i < src.length; i++) {
      const col = Math.floor(i / WEAVE_HOURS);
      byWeekday[weekdayOf(grid.firstDay + col)] += src[i];
      byHour[i % WEAVE_HOURS] += src[i];
      total += src[i];
    }
  }
  const argmax = (a: number[]) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
  return { total, weekday: total > 0 ? argmax(byWeekday) : -1, hour: total > 0 ? argmax(byHour) + WEAVE_FIRST_HOUR : -1 };
}
