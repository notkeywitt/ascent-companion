/**
 * The Cost Cloud — the first piece on /art. Turns rows (bill lines, time
 * entries, budget lines) into a PCA cloud: every row is one dot, placed by its
 * scores on the main components, coloured by its k-means cluster.
 *
 * Pure: the Pave reads live in src/lib/jobtread/artCloud.ts and hand this
 * module plain `CloudRecord`s.
 */
import { kmeans, pca, standardize } from "./pca";

export type CloudSetId = "bills" | "labor" | "budget";

/** One row before it becomes numbers. */
export interface CloudRecord {
  /** What the tooltip names the dot by. */
  title: string;
  /** Its money or hours figure, shown in the tooltip. */
  value: number;
  /** A quiet second line: vendor, code, date… */
  meta: string;
  num: Record<string, number>;
  cat: Record<string, string>;
  /** Free text whose common words become features (a line's name). */
  text?: string;
}

interface NumFeature {
  key: string;
  label: string;
  /** Signed log10(1 + |v|): money and quantities span five orders of magnitude. */
  log?: boolean;
  weight?: number;
}
interface CatFeature {
  key: string;
  label: string;
  /** A value seen fewer times than this is folded into no column. */
  minCount?: number;
  /** At most this many columns, most common first. */
  max?: number;
  weight?: number;
}
export interface CloudSpec {
  id: CloudSetId;
  title: string;
  /** One line under the title: what a dot is. */
  dot: string;
  /** "money" or "hours": how the tooltip prints `value`. */
  unit: "money" | "hours";
  num: NumFeature[];
  cat: CatFeature[];
  words?: { max: number; minCount: number; weight: number };
}

export const CLOUD_SPECS: Record<CloudSetId, CloudSpec> = {
  bills: {
    id: "bills",
    title: "Bill lines",
    dot: "One dot per line on a vendor bill",
    unit: "money",
    num: [
      { key: "cost", label: "line cost", log: true },
      { key: "qty", label: "quantity", log: true },
      { key: "unit", label: "unit cost", log: true },
      { key: "month", label: "bill month", weight: 0.6 },
    ],
    cat: [
      { key: "type", label: "type", minCount: 5 },
      { key: "div", label: "division", minCount: 8, weight: 0.8 },
      { key: "vendor", label: "vendor", minCount: 15, max: 15, weight: 0.6 },
    ],
    words: { max: 50, minCount: 10, weight: 0.5 },
  },
  labor: {
    id: "labor",
    title: "Crew time",
    dot: "One dot per time entry",
    unit: "hours",
    num: [
      { key: "hours", label: "hours", log: true },
      { key: "start", label: "start hour" },
      { key: "dowSin", label: "weekday (sin)", weight: 0.7 },
      { key: "dowCos", label: "weekday (cos)", weight: 0.7 },
      { key: "day", label: "date", weight: 0.8 },
    ],
    cat: [
      { key: "person", label: "person", minCount: 5 },
      { key: "div", label: "division", minCount: 5, weight: 0.8 },
      { key: "job", label: "job", minCount: 10, max: 12, weight: 0.7 },
      { key: "pay", label: "pay type", minCount: 5, weight: 0.6 },
    ],
  },
  budget: {
    id: "budget",
    title: "Budget lines",
    dot: "One dot per line in a job's budget",
    unit: "money",
    num: [
      { key: "cost", label: "cost", log: true },
      { key: "price", label: "price", log: true },
      { key: "qty", label: "quantity", log: true },
      { key: "margin", label: "margin" },
    ],
    cat: [
      { key: "type", label: "type", minCount: 5 },
      { key: "div", label: "division", minCount: 8, weight: 0.8 },
      { key: "job", label: "job", minCount: 10, max: 12, weight: 0.7 },
    ],
    words: { max: 40, minCount: 8, weight: 0.5 },
  },
};

/** Common words in line names that say nothing about the item. */
const STOP = new Set(
  "the and for with from per each new item items qty ext int inc llc sku".split(" "),
);
export function words(s: string | undefined): string[] {
  const out = new Set<string>();
  for (const w of (s ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? []) if (!STOP.has(w)) out.add(w);
  return [...out];
}

const slog = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v));

/** Columns, most common value first, that pass `minCount` and `max`. */
function keepValues(values: string[], minCount: number, max: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([v]) => v);
}

/** The feature matrix: one row per record, one column per named feature. */
export function featureMatrix(
  spec: CloudSpec,
  recs: CloudRecord[],
): { rows: number[][]; names: string[] } {
  const names: string[] = [];
  const blocks: { weight: number; cols: number[][] }[] = [];

  for (const f of spec.num) {
    names.push(f.label);
    blocks.push({
      weight: f.weight ?? 1,
      cols: [recs.map((r) => (f.log ? slog(r.num[f.key] ?? 0) : (r.num[f.key] ?? 0)))],
    });
  }
  for (const f of spec.cat) {
    const keep = keepValues(recs.map((r) => r.cat[f.key] ?? ""), f.minCount ?? 5, f.max ?? 30);
    for (const v of keep) names.push(`${f.label}: ${v}`);
    blocks.push({
      weight: f.weight ?? 1,
      cols: keep.map((v) => recs.map((r) => (r.cat[f.key] === v ? 1 : 0))),
    });
  }
  if (spec.words) {
    const per = recs.map((r) => new Set(words(r.text)));
    const keep = keepValues(
      per.flatMap((s) => [...s]),
      spec.words.minCount,
      spec.words.max,
    );
    for (const w of keep) names.push(`word: ${w}`);
    blocks.push({ weight: spec.words.weight, cols: keep.map((w) => per.map((s) => (s.has(w) ? 1 : 0))) });
  }

  const columns = blocks.flatMap((b) => b.cols);
  const weights = blocks.flatMap((b) => b.cols.map(() => b.weight));
  const raw = recs.map((_, i) => columns.map((c) => c[i]));
  const z = standardize(raw);
  return { rows: z.map((r) => r.map((v, j) => v * weights[j])), names };
}

export const CLOUD_COMPONENTS = 6;
export const CLOUD_CLUSTERS = 8;

export interface CloudComponent {
  /** Share of the spread this component explains, 0..1. */
  explained: number;
  /** The features that push a dot toward + and toward −, strongest first. */
  plus: string[];
  minus: string[];
}

export interface CloudCluster {
  id: number;
  size: number;
  /** A short name from what its rows have most in common. */
  label: string;
}

/** [pc1..pc6 scaled to about −1..1, cluster, title, value, meta]. */
export type CloudPoint = [number, number, number, number, number, number, number, string, number, string];

export interface CloudPayload {
  id: CloudSetId;
  title: string;
  dot: string;
  unit: "money" | "hours";
  features: number;
  components: CloudComponent[];
  clusters: CloudCluster[];
  points: CloudPoint[];
}

/** The 98th percentile of |v| — the scale that fills the frame without letting
 *  a handful of outliers squash everything else into the middle. */
function robustScale(vals: number[]): number {
  const a = vals.map(Math.abs).sort((x, y) => x - y);
  if (a.length === 0) return 1;
  return a[Math.min(a.length - 1, Math.floor(a.length * 0.98))] || a[a.length - 1] || 1;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A feature name as a cluster label: "division: 06" → "Div 06",
 *  "word: paint" → "paint", "unit cost" → "high unit cost". */
export function friendly(name: string, high = true): string {
  const m = name.match(/^([a-z ]+): (.*)$/);
  if (!m) return high ? `high ${name}` : name;
  return m[1] === "division" ? `Div ${m[2]}` : m[2];
}

/** Name a cluster by the feature its rows sit furthest above average on. */
function clusterLabels(rows: number[][], names: string[], label: number[], k: number): string[] {
  const d = names.length;
  return Array.from({ length: k }, (_, c) => {
    const mean = new Array(d).fill(0);
    let n = 0;
    rows.forEach((r, i) => {
      if (label[i] !== c) return;
      n++;
      for (let j = 0; j < d; j++) mean[j] += r[j];
    });
    if (!n) return "Empty";
    const top = mean
      .map((v, j) => ({ v: v / n, j }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 2)
      .map((x) => friendly(names[x.j]));
    return top.length ? top.join(" · ") : "Mixed";
  });
}

/** Records → the payload the page draws. */
export function buildCloud(spec: CloudSpec, recs: CloudRecord[]): CloudPayload {
  const { rows, names } = featureMatrix(spec, recs);
  const res = pca(rows, CLOUD_COMPONENTS);
  const k = Math.min(CLOUD_CLUSTERS, Math.max(1, Math.floor(recs.length / 20)));
  const label = kmeans(res.scores, k, 11);
  const scale = Array.from({ length: CLOUD_COMPONENTS }, (_, c) =>
    robustScale(res.scores.map((s) => s[c] ?? 0)),
  );
  const labels = clusterLabels(rows, names, label, k);
  const sizes = new Array(k).fill(0);
  for (const l of label) sizes[l]++;

  return {
    id: spec.id,
    title: spec.title,
    dot: spec.dot,
    unit: spec.unit,
    features: names.length,
    components: res.components.map((vec, c) => {
      const order = vec.map((w, j) => ({ w, j })).sort((a, b) => b.w - a.w);
      return {
        explained: r3(res.explained[c] ?? 0),
        plus: order.filter((o) => o.w > 0).slice(0, 4).map((o) => friendly(names[o.j], false)),
        minus: order
          .filter((o) => o.w < 0)
          .slice(-4)
          .reverse()
          .map((o) => friendly(names[o.j], false)),
      };
    }),
    clusters: labels.map((l, c) => ({ id: c, size: sizes[c], label: l })),
    points: recs.map((r, i) => {
      const s = Array.from({ length: CLOUD_COMPONENTS }, (_, c) => r3((res.scores[i][c] ?? 0) / scale[c]));
      return [s[0], s[1], s[2], s[3], s[4], s[5], label[i], r.title.slice(0, 80), Math.round(r.value * 100) / 100, r.meta];
    }),
  };
}
