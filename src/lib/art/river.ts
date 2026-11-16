/**
 * Spend River maths: weekly bill spend by group, the 3-week spread and the
 * stacked "wiggle" baseline. Pure: no React, no DOM.
 */

const DAY_MS = 86_400_000;

/** One bill line, as far as the river cares. */
export interface RiverRow {
  cost: number;
  /** "YYYY-MM-DD". */
  date: string;
}

export interface RiverLayer {
  key: string;
  total: number;
  values: number[];
}

const dayOf = (date: string) => Math.floor(Date.parse(date.slice(0, 10)) / DAY_MS);

/** ISO week number counted from the epoch: weeks start on Monday. */
export const weekOf = (date: string) => Math.floor((dayOf(date) + 3) / 7);

/** The day number (days since 1970-01-01) of the Monday that starts `week`. */
export const weekStartDay = (week: number) => week * 7 - 3;

/**
 * Weekly spend by key. Each bill's cost spreads evenly over its own week and
 * the week either side, so a lone big bill reads as a swell. The range runs one
 * week past each end so the spread loses nothing.
 */
export function weeklyByKey<R extends RiverRow>(
  rows: readonly R[],
  keyOf: (row: R) => string,
): { first: number; count: number; series: Map<string, number[]> } {
  const dated = rows.filter((r) => Number.isFinite(dayOf(r.date)));
  if (!dated.length) return { first: 0, count: 0, series: new Map() };
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of dated) {
    const w = weekOf(r.date);
    if (w < lo) lo = w;
    if (w > hi) hi = w;
  }
  const first = lo - 1;
  const count = hi - lo + 3;
  const series = new Map<string, number[]>();
  for (const r of dated) {
    const k = keyOf(r);
    let arr = series.get(k);
    if (!arr) {
      arr = new Array<number>(count).fill(0);
      series.set(k, arr);
    }
    const i = weekOf(r.date) - first;
    const part = (Number.isFinite(r.cost) ? r.cost : 0) / 3;
    arr[i - 1] += part;
    arr[i] += part;
    arr[i + 1] += part;
  }
  return { first, count, series };
}

/**
 * The biggest `n` keys by total, the rest folded into "Other". A stream cannot
 * run backwards, so a week's credit counts as zero. Largest first, Other last.
 */
export function foldTop(series: Map<string, number[]>, n = 7): RiverLayer[] {
  const clean = [...series].map(([key, v]) => {
    const values = v.map((x) => Math.max(0, x));
    return { key, values, total: values.reduce((a, b) => a + b, 0) };
  });
  clean.sort((a, b) => b.total - a.total);
  const top = clean.filter((l) => l.key !== "Other").slice(0, n);
  const keep = new Set(top.map((l) => l.key));
  const rest = clean.filter((l) => !keep.has(l.key));
  if (rest.length) {
    const len = rest[0].values.length;
    const values = new Array<number>(len).fill(0);
    for (const l of rest) for (let i = 0; i < len; i++) values[i] += l.values[i];
    top.push({ key: "Other", values, total: values.reduce((a, b) => a + b, 0) });
  }
  return top.filter((l) => l.total > 0 || l.key !== "Other");
}

/** Put the biggest item in the middle and alternate the rest outward. */
export function insideOut<T>(sortedDesc: readonly T[]): T[] {
  const left: T[] = [];
  const right: T[] = [];
  sortedDesc.forEach((item, i) => (i % 2 ? left : right).push(item));
  return [...left.reverse(), ...right];
}

/**
 * Stack layers (bottom to top) on the Byrne & Wattenberg "wiggle" baseline,
 * which keeps the slope of the layers small. `upper - lower` of a layer is
 * its value, so the total thickness of a week is the week's total.
 */
export function stackWiggle(values: readonly (readonly number[])[]): { lower: number[][]; upper: number[][] } {
  const n = values.length;
  const len = n ? values[0].length : 0;
  const base = new Array<number>(len).fill(0);
  for (let j = 1; j < len; j++) {
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const f = values[i][j] || 0;
      let s3 = (f - (values[i][j - 1] || 0)) / 2;
      for (let k = 0; k < i; k++) s3 += (values[k][j] || 0) - (values[k][j - 1] || 0);
      s1 += f;
      s2 += s3 * f;
    }
    base[j] = base[j - 1] - (s1 ? s2 / s1 : 0);
  }
  const lower: number[][] = [];
  const upper: number[][] = [];
  const run = base.slice();
  for (let i = 0; i < n; i++) {
    lower.push(run.slice());
    for (let j = 0; j < len; j++) run[j] += values[i][j] || 0;
    upper.push(run.slice());
  }
  return { lower, upper };
}
