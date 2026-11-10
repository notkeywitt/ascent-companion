// How the tool schedule page lays its data out — pure and client-safe. The
// rules that decide what is needed live in toolSchedule.ts; this only arranges
// the answer for the Gantt, the calendar and the list.

import { dayIso, dayNum, type DemandSpan, type KindSchedule } from "@/lib/toolSchedule";

/** A span placed on a lane, so overlapping spans in one Gantt row stack. */
export interface LanedSpan extends DemandSpan {
  lane: number;
}

/** First-fit lanes: each span takes the lowest lane free on its first day. */
export function assignLanes(spans: DemandSpan[]): { spans: LanedSpan[]; lanes: number } {
  const ends: number[] = [];
  const sorted = [...spans].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const out = sorted.map((s) => {
    const a = dayNum(s.startDate);
    let lane = ends.findIndex((end) => end < a);
    if (lane < 0) {
      lane = ends.length;
      ends.push(dayNum(s.endDate));
    } else ends[lane] = dayNum(s.endDate);
    return { ...s, lane };
  });
  return { spans: out, lanes: Math.max(1, ends.length) };
}

/** One tool type's need on one day. */
export interface DayNeed {
  kindId: string;
  name: string;
  need: number;
  owned: number;
  short: boolean;
  jobs: { id: string; name: string }[];
}

function needOn(row: KindSchedule, a: number, b: number): DayNeed | null {
  const hit = row.spans.filter((s) => dayNum(s.startDate) <= b && dayNum(s.endDate) >= a);
  if (hit.length === 0) return null;
  // The peak over the period, counting a job once a day (its largest quantity).
  let need = 0;
  for (let d = a; d <= b; d++) {
    const perJob = new Map<string, number>();
    for (const s of hit)
      if (dayNum(s.startDate) <= d && dayNum(s.endDate) >= d) perJob.set(s.jobId, Math.max(perJob.get(s.jobId) ?? 0, s.qty));
    let n = 0;
    for (const q of perJob.values()) n += q;
    need = Math.max(need, n);
  }
  const jobs = new Map<string, string>();
  for (const s of hit) jobs.set(s.jobId, s.jobName);
  return {
    kindId: row.kindId,
    name: row.name,
    need,
    owned: row.owned,
    short: need > row.owned,
    jobs: [...jobs].map(([id, name]) => ({ id, name })),
  };
}

const byShortThenName = (a: DayNeed, b: DayNeed) => Number(b.short) - Number(a.short) || a.name.localeCompare(b.name);

/** Every tool type needed on `day`, shortfalls first. */
export function needsOnDay(rows: KindSchedule[], day: string): DayNeed[] {
  const d = dayNum(day);
  return rows.map((r) => needOn(r, d, d)).filter((x): x is DayNeed => !!x).sort(byShortThenName);
}

/** Monday of the week `day` falls in. */
export function mondayOf(day: string): string {
  const n = dayNum(day);
  const dow = new Date(n * 86_400_000).getUTCDay(); // 0 = Sunday
  return dayIso(n - ((dow + 6) % 7));
}

/** The range as weeks (Monday first), each with the tool types it needs. Empty weeks are left out. */
export function weeksOfNeed(rows: KindSchedule[], from: string, to: string): { week: string; needs: DayNeed[] }[] {
  const out: { week: string; needs: DayNeed[] }[] = [];
  const f = dayNum(from);
  const t = dayNum(to);
  for (let w = dayNum(mondayOf(from)); w <= t; w += 7) {
    const a = Math.max(f, w);
    const b = Math.min(t, w + 6);
    const needs = rows.map((r) => needOn(r, a, b)).filter((x): x is DayNeed => !!x).sort(byShortThenName);
    if (needs.length) out.push({ week: dayIso(w), needs });
  }
  return out;
}

/** A stable colour slot (0–7) per job, in the order jobs first appear. */
export function jobColourIndex(jobIds: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of jobIds) if (!m.has(id)) m.set(id, m.size % 8);
  return m;
}
