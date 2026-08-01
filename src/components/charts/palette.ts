/**
 * Chart palette + pure geometry/format helpers shared by BarChart and PieChart.
 *
 * The categorical hues themselves live as CSS custom properties in globals.css
 * (--series-1 … --series-8) so they swap with the .dark theme in one place;
 * this module only exposes the var() references in slot order plus the maths
 * the SVG renderers need. Assign hues by SLOT and never cycle a ninth — fold
 * extra categories into "Other" (PieChart does this for you).
 */

export const SERIES_COUNT = 8;

/** All eight categorical slot var() references, in the fixed data-viz order. */
export const SERIES_VARS: readonly string[] = Array.from(
  { length: SERIES_COUNT },
  (_, i) => `var(--series-${i + 1})`,
);

/** var() reference for categorical slot `i` (0-based). Beyond slot 8 it wraps,
 *  but callers should fold extras into "Other" rather than rely on that. */
export function seriesVar(i: number): string {
  return `var(--series-${(i % SERIES_COUNT) + 1})`;
}

/** The active-theme brand accent (ochre in light, olive in dark) — the fill for
 *  a SINGLE-series bar chart, where one hue carries the whole plot. */
export const ACCENT_VAR = "rgb(var(--accent))";

/* --------------------------------------------------------------- formatting */

export type ValueFormat = (n: number) => string;

/** A compact default formatter: `$1.2k`, `1,240`, `85%`. Pass your own `format`
 *  prop to override (e.g. full currency). */
export function makeFormat(opts: { currency?: boolean; percent?: boolean; compact?: boolean } = {}): ValueFormat {
  const { currency = false, percent = false, compact = true } = opts;
  return (n: number): string => {
    if (!isFinite(n)) return "—";
    if (percent) return `${Math.round(n * 1000) / 10}%`;
    const prefix = currency ? "$" : "";
    const abs = Math.abs(n);
    if (compact && abs >= 1_000_000) return `${prefix}${trim(n / 1_000_000)}M`;
    if (compact && abs >= 1_000) return `${prefix}${trim(n / 1_000)}k`;
    return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };
}

function trim(n: number): string {
  // One decimal, but drop a trailing .0 (1.0k → 1k).
  return (Math.round(n * 10) / 10).toString();
}

/** The plain currency formatter used by the demo/table (no k/M compaction). */
export const currencyFull: ValueFormat = (n) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/* ---------------------------------------------------------------- geometry */

/** Round a maximum up to a "nice" axis ceiling (1/2/5 × 10ⁿ). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** SVG path for a rect with only the two FAR-end corners rounded, anchored to
 *  the baseline (data-viz mark spec: 4px rounded data-end, square at baseline).
 *  `side` says which edge is the baseline the bar grows FROM. */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  side: "bottom" | "left",
): string {
  const rr = Math.max(0, Math.min(r, side === "bottom" ? w / 2 : h / 2, side === "bottom" ? h : w));
  if (side === "bottom") {
    // Baseline at bottom; round the TOP two corners.
    return [
      `M${x},${y + h}`,
      `L${x},${y + rr}`,
      `Q${x},${y} ${x + rr},${y}`,
      `L${x + w - rr},${y}`,
      `Q${x + w},${y} ${x + w},${y + rr}`,
      `L${x + w},${y + h}`,
      "Z",
    ].join(" ");
  }
  // Baseline at left; round the RIGHT two corners.
  return [
    `M${x},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h - rr}`,
    `Q${x + w},${y + h} ${x + w - rr},${y + h}`,
    `L${x},${y + h}`,
    "Z",
  ].join(" ");
}

/** Cartesian point on a circle for a given angle (degrees, 0° = 12 o'clock,
 *  clockwise). Used to lay out pie/donut arcs. */
export function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

/** SVG path for a donut (annular) segment between two angles. For a full pie
 *  pass `innerRadius = 0`. Angles in degrees, clockwise from 12 o'clock. */
export function arcPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startDeg: number,
  endDeg: number,
): string {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const o0 = polar(cx, cy, outerR, startDeg);
  const o1 = polar(cx, cy, outerR, endDeg);
  if (innerR <= 0) {
    return [
      `M${cx},${cy}`,
      `L${o0.x},${o0.y}`,
      `A${outerR},${outerR} 0 ${largeArc} 1 ${o1.x},${o1.y}`,
      "Z",
    ].join(" ");
  }
  const i1 = polar(cx, cy, innerR, endDeg);
  const i0 = polar(cx, cy, innerR, startDeg);
  return [
    `M${o0.x},${o0.y}`,
    `A${outerR},${outerR} 0 ${largeArc} 1 ${o1.x},${o1.y}`,
    `L${i1.x},${i1.y}`,
    `A${innerR},${innerR} 0 ${largeArc} 0 ${i0.x},${i0.y}`,
    "Z",
  ].join(" ");
}
