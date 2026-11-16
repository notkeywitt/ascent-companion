/**
 * Line Words maths: tokenise line names, weigh the words and lay them out on a
 * spiral. Pure: the layout takes a `measure` callback instead of a canvas.
 */
import { divisionOf } from "./rows";

export interface WordRow {
  name: string;
  cost: number;
  code: string;
}

export type WordBy = "dollars" | "count";

export interface WordStat {
  word: string;
  dollars: number;
  count: number;
  /** The CSI division with the most dollars (then lines) among this word's lines. */
  division: string;
  /** What sets the size: dollars or count. */
  weight: number;
}

const STOP = new Set(["the", "and", "for", "with", "from", "per", "each", "new", "item", "qty", "ext", "int", "inc", "llc", "sku"]);

/** The distinct lowercase words of 3+ letters in a name, stop words dropped. */
export function tokenize(name: string): string[] {
  const out = new Set<string>();
  for (const w of name.toLowerCase().match(/[a-z]+/g) ?? []) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  return [...out];
}

/** The top `top` words by weight, biggest first. */
export function wordStats(rows: readonly WordRow[], by: WordBy, top = 120): WordStat[] {
  const m = new Map<string, { dollars: number; count: number; div: Map<string, [number, number]> }>();
  for (const r of rows) {
    const dollars = Number.isFinite(r.cost) && r.cost > 0 ? r.cost : 0;
    const d = divisionOf(r.code);
    for (const w of tokenize(r.name)) {
      let e = m.get(w);
      if (!e) {
        e = { dollars: 0, count: 0, div: new Map() };
        m.set(w, e);
      }
      e.dollars += dollars;
      e.count += 1;
      const c = e.div.get(d) ?? [0, 0];
      c[0] += dollars;
      c[1] += 1;
      e.div.set(d, c);
    }
  }
  const out: WordStat[] = [];
  for (const [word, e] of m) {
    let division = "none";
    let best: [number, number] = [-1, -1];
    for (const [d, c] of e.div) {
      if (c[0] > best[0] || (c[0] === best[0] && c[1] > best[1])) {
        best = c;
        division = d;
      }
    }
    out.push({ word, dollars: e.dollars, count: e.count, division, weight: by === "dollars" ? e.dollars : e.count });
  }
  out.sort((a, b) => b.weight - a.weight || b.count - a.count || a.word.localeCompare(b.word));
  return out.filter((s) => s.weight > 0).slice(0, top);
}

/** The `n` divisions with the most dollars across all rows, biggest first. */
export function rankDivisions(rows: readonly WordRow[], n = 7): string[] {
  const t = new Map<string, number>();
  for (const r of rows) {
    const d = divisionOf(r.code);
    t.set(d, (t.get(d) ?? 0) + (r.cost > 0 ? r.cost : 0));
  }
  return [...t]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([d]) => d);
}

/** Font size from weight: 11px up to 64px (less on a narrow canvas) on a sqrt scale. */
export function fontSize(weight: number, maxWeight: number, scale = 1): number {
  const hi = 64 * scale;
  const t = maxWeight > 0 ? Math.sqrt(Math.max(0, weight) / maxWeight) : 0;
  return 11 + (Math.max(11, hi) - 11) * t;
}

export interface PlacedWord {
  word: string;
  size: number;
  /** Box centre. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Place words (biggest first) on an Archimedean spiral out from the centre.
 * Boxes are axis-aligned and never overlap; a word that finds no room is skipped.
 */
export function layoutWords(
  words: readonly { word: string; size: number }[],
  width: number,
  height: number,
  measure: (word: string, size: number) => { w: number; h: number },
  pad = 2,
): PlacedWord[] {
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(width, height) / 2 + 20;
  const stretch = Math.max(1, Math.min(2, width / Math.max(1, height)));
  const placed: PlacedWord[] = [];
  for (const { word, size } of words) {
    const { w, h } = measure(word, size);
    if (w > width || h > height) continue;
    for (let t = 0, r = 0; r < maxR; t += 0.12, r = 1.4 * t) {
      const x = cx + r * Math.cos(t) * stretch;
      const y = cy + r * Math.sin(t);
      if (x - w / 2 < 0 || x + w / 2 > width || y - h / 2 < 0 || y + h / 2 > height) continue;
      const hit = placed.some(
        (p) => Math.abs(x - p.x) < (w + p.w) / 2 + pad && Math.abs(y - p.y) < (h + p.h) / 2 + pad,
      );
      if (hit) continue;
      placed.push({ word, size, x, y, w, h });
      break;
    }
  }
  return placed;
}
