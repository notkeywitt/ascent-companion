/**
 * Pure maths for Week Rose: crew hours in 168 weekday-hour buckets.
 * Bucket = weekday * 24 + hour, Monday = 0. No React, no DOM.
 */
import type { ArtTimeRow } from "./rows";
import { personColor, splitHours, weekdayOf } from "./weave";

export type RoseRow = Pick<ArtTimeRow, "start" | "hours" | "person">;

export const ROSE_BUCKETS = 168;
export const ROSE_MAX_PEOPLE = 8;

export const bucketOf = (weekday: number, hour: number) => weekday * 24 + hour;

export interface RoseData {
  /** People by total hours, biggest first. */
  people: { name: string; total: number }[];
  /** Per person (same order as `people`): hours in each of the 168 buckets. */
  byPerson: Float64Array[];
  all: Float64Array;
  total: number;
}

export function buildRose(rows: readonly RoseRow[]): RoseData {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.hours > 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.start)) {
      const name = r.person || "Unknown";
      totals.set(name, (totals.get(name) ?? 0) + r.hours);
    }
  }
  const people = [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const rank = new Map(people.map((p, i) => [p.name, i]));
  const byPerson = people.map(() => new Float64Array(ROSE_BUCKETS));
  const all = new Float64Array(ROSE_BUCKETS);
  for (const r of rows) {
    const grid = byPerson[rank.get(r.person || "Unknown") ?? -1];
    if (!grid) continue;
    for (const p of splitHours(r.start, r.hours)) {
      const b = bucketOf(weekdayOf(p.day), p.hour);
      grid[b] += p.hours;
      all[b] += p.hours;
    }
  }
  let total = 0;
  for (let i = 0; i < ROSE_BUCKETS; i++) total += all[i];
  return { people, byPerson, all, total };
}

export interface RoseSeries {
  key: string;
  name: string;
  total: number;
  buckets: Float64Array;
  /** Colour slot, or -1 for the folded "Others". */
  color: number;
  /** The person's index in `RoseData.people`, or -1 for "Others". */
  person: number;
}

/** The overlaid roses: the biggest eight people, then the rest folded into "Others". */
export function overlaySeries(rose: RoseData, maxPeople = ROSE_MAX_PEOPLE): RoseSeries[] {
  const out: RoseSeries[] = rose.people.slice(0, maxPeople).map((p, i) => ({
    key: p.name,
    name: p.name,
    total: p.total,
    buckets: rose.byPerson[i],
    color: personColor(i),
    person: i,
  }));
  if (rose.people.length > maxPeople) {
    const buckets = new Float64Array(ROSE_BUCKETS);
    let total = 0;
    for (let i = maxPeople; i < rose.people.length; i++) {
      total += rose.people[i].total;
      for (let b = 0; b < ROSE_BUCKETS; b++) buckets[b] += rose.byPerson[i][b];
    }
    out.push({ key: "Others", name: "Others", total, buckets, color: -1, person: -1 });
  }
  return out;
}

/** One person's rose alone. */
export function personSeries(rose: RoseData, person: number): RoseSeries | null {
  const p = rose.people[person];
  if (!p) return null;
  return { key: p.name, name: p.name, total: p.total, buckets: rose.byPerson[person], color: personColor(person), person };
}

/** A bucket's radius 0..1: square root of its hours over the largest bucket shown. */
export const petalRadius = (hours: number, max: number) => (max > 0 ? Math.sqrt(hours / max) : 0);
