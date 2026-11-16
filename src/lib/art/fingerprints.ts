/**
 * Job Fingerprint maths: each job's spread of budget across CSI divisions.
 * Pure: no React, no DOM.
 */
import { divisionOf } from "./rows";

export interface FpRow {
  cost: number;
  price: number;
  code: string;
  job: string;
}

export type FpMode = "cost" | "price" | "margin";

export interface JobAgg {
  job: string;
  cost: number;
  price: number;
  byDiv: Map<string, { cost: number; price: number }>;
}

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Every job's totals, biggest budget cost first. */
export function aggregateJobs(rows: readonly FpRow[]): JobAgg[] {
  const jobs = new Map<string, JobAgg>();
  for (const r of rows) {
    const name = r.job.trim() || "No job";
    let j = jobs.get(name);
    if (!j) {
      j = { job: name, cost: 0, price: 0, byDiv: new Map() };
      jobs.set(name, j);
    }
    const d = divisionOf(r.code);
    const cell = j.byDiv.get(d) ?? { cost: 0, price: 0 };
    cell.cost += pos(r.cost);
    cell.price += pos(r.price);
    j.byDiv.set(d, cell);
    j.cost += pos(r.cost);
    j.price += pos(r.price);
  }
  return [...jobs.values()].sort((a, b) => b.cost - a.cost);
}

/** The `n` divisions with the most total cost across all rows, biggest first. */
export function axisDivisions(rows: readonly FpRow[], n = 8): string[] {
  const t = new Map<string, number>();
  for (const r of rows) {
    const d = divisionOf(r.code);
    t.set(d, (t.get(d) ?? 0) + pos(r.cost));
  }
  return [...t]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([d]) => d);
}

/** A job's share of its own total in each division. The shares sum to 1. */
export function divisionShares(j: JobAgg, field: "cost" | "price"): Map<string, number> {
  const total = j[field];
  const out = new Map<string, number>();
  for (const [d, cell] of j.byDiv) out.set(d, total > 0 ? cell[field] / total : 0);
  return out;
}

/** One division's value for a job, 0 to 1. */
export function divisionValue(j: JobAgg, div: string, mode: FpMode): number {
  const cell = j.byDiv.get(div);
  if (!cell) return 0;
  if (mode === "margin") return cell.price > 0 ? Math.max(0, Math.min(1, (cell.price - cell.cost) / cell.price)) : 0;
  const total = j[mode];
  return total > 0 ? cell[mode] / total : 0;
}

/** The glyph's values, one per axis. */
export function glyphValues(j: JobAgg, axes: readonly string[], mode: FpMode): number[] {
  return axes.map((d) => divisionValue(j, d, mode));
}

/** A job's `n` strongest divisions in this mode, with the dollars behind each. */
export function topDivisionsOf(j: JobAgg, mode: FpMode, n = 3): { div: string; value: number; dollars: number }[] {
  return [...j.byDiv]
    .map(([div, cell]) => ({
      div,
      value: divisionValue(j, div, mode),
      dollars: mode === "price" ? cell.price : mode === "margin" ? cell.price - cell.cost : cell.cost,
    }))
    .sort((a, b) => b.value - a.value || a.div.localeCompare(b.div))
    .slice(0, n);
}
