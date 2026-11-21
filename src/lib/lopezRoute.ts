/**
 * The drive between two points on the Lopez map, along the drawn roads.
 *
 * Builds a graph from LOPEZ_ROADS_MAJOR / LOPEZ_ROADS_MINOR once, joins road
 * ends that sit within JOIN map units of another road's point (simplification
 * drops some shared junction points), and runs Dijkstra. No network call: it is
 * only the line the Miles map highlights, not the trip's miles.
 */
import { LOPEZ_ROADS_MAJOR, LOPEZ_ROADS_MINOR } from "@/lib/lopezMap";

export type Pt = { x: number; y: number };

/** Two road points closer than this are one junction. */
const JOIN = 2;

interface Graph {
  pts: Pt[];
  edges: { to: number; w: number }[][];
  /** Nodes in the largest connected road network. Stubs that never join it
   *  (a lone private road) are left out, so a trip snaps to a road that goes
   *  somewhere. */
  main: Uint8Array;
}

let graph: Graph | null = null;

function buildGraph(): Graph {
  const pts: Pt[] = [];
  const edges: { to: number; w: number }[][] = [];
  const cell = new Map<string, number[]>();
  const ck = (x: number, y: number) => `${Math.floor(x / JOIN)},${Math.floor(y / JOIN)}`;

  // One node per distinct point; a point within JOIN of an existing node reuses it.
  const node = (x: number, y: number): number => {
    const cx = Math.floor(x / JOIN), cy = Math.floor(y / JOIN);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cell.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(pts[i].x - x, pts[i].y - y) < JOIN) return i;
        }
      }
    }
    pts.push({ x, y });
    edges.push([]);
    const k = ck(x, y);
    cell.set(k, [...(cell.get(k) ?? []), pts.length - 1]);
    return pts.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const w = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
    edges[a].push({ to: b, w });
    edges[b].push({ to: a, w });
  };

  for (const d of [LOPEZ_ROADS_MAJOR, LOPEZ_ROADS_MINOR]) {
    for (const way of d.split("M").filter(Boolean)) {
      let prev = -1;
      for (const m of way.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) {
        const i = node(Number(m[1]), Number(m[2]));
        if (prev >= 0) link(prev, i);
        prev = i;
      }
    }
  }
  // Label components; keep the biggest.
  const comp = new Int32Array(pts.length).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (comp[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const u = stack.pop()!;
      n++;
      for (const { to } of edges[u]) {
        if (comp[to] < 0) {
          comp[to] = id;
          stack.push(to);
        }
      }
    }
    sizes.push(n);
  }
  const big = sizes.indexOf(Math.max(...sizes));
  const main = new Uint8Array(pts.length);
  comp.forEach((c, i) => (main[i] = c === big ? 1 : 0));
  return { pts, edges, main };
}

function nearest(g: Graph, p: Pt): number {
  let best = -1, bd = Infinity;
  g.pts.forEach((q, i) => {
    if (!g.main[i]) return;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

/**
 * The road line from `a` to `b`, ends included. A straight line when the two
 * nearest roads do not connect.
 */
export function roadPath(a: Pt, b: Pt): Pt[] {
  graph ??= buildGraph();
  const g = graph;
  const s = nearest(g, a), t = nearest(g, b);
  if (s < 0 || t < 0) return [a, b];

  const dist = new Float64Array(g.pts.length).fill(Infinity);
  const prev = new Int32Array(g.pts.length).fill(-1);
  dist[s] = 0;
  // Binary heap of [dist, node].
  const heap: [number, number][] = [[0, s]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > dist[u]) continue;
    for (const { to, w } of g.edges[u]) {
      if (d + w < dist[to]) {
        dist[to] = d + w;
        prev[to] = u;
        push([d + w, to]);
      }
    }
  }
  if (dist[t] === Infinity) return [a, b];
  const path: Pt[] = [];
  for (let u = t; u >= 0; u = prev[u]) path.push(g.pts[u]);
  path.reverse();
  return [a, ...path, b];
}
