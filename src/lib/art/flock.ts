/**
 * Job Flock (/art/flock): a boids simulation where every bird is one row (a
 * bill line, a time entry, a budget line). Pure: no DOM, no imports.
 *
 * Each bird steers by three local rules, plus three that come from the data:
 *   separation   keep clear of any bird too close, whatever its flock;
 *   alignment    match the heading of nearby birds of the SAME group;
 *   cohesion     move toward nearby birds of the same group, and a little
 *                toward its whole group's centre, so a group forms one flock;
 *   roaming      each group follows its own slow, looping goal across the
 *                screen, so the flocks travel rather than sit;
 *   affinity     drift toward the centre of other groups it shares links with
 *                (two jobs that use the same vendors fly near each other),
 *                and away from groups it shares nothing with;
 *   pace         a group's top speed follows how busy it was lately;
 *   predator     flee the pointer.
 * The walls are soft: a bird near an edge is turned back, never wrapped, so a
 * flock's centre is always a real place on screen.
 */

export interface FlockBirdInit {
  group: number;
  /** 0..1, how big the bird draws (from its row's value). */
  size: number;
}

export interface FlockParams {
  /** Groups' top-speed factors, about 0.6..1.6. */
  pace: number[];
  /** affinity[g][h], 0..1: how much group g is drawn to group h. */
  affinity: number[][];
}

const R = 34; // how far a bird sees its own flock
const SEP = 13; // how close is too close
const SHY = 170; // unrelated flocks keep about this far apart
const BASE_SPEED = 1.6; // px per step at pace 1
const MIN_SPEED = 0.55;
const MARGIN = 36;

export class Flock {
  n: number;
  w: number;
  h: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  group: Int32Array;
  size: Float32Array;
  groups: number;
  params: FlockParams;
  /** Each group's centre and count, refreshed every step. */
  cx: Float32Array;
  cy: Float32Array;
  count: Int32Array;
  /** Steps taken; drives each group's roaming goal. */
  t = 0;
  private rand: () => number;

  constructor(birds: FlockBirdInit[], params: FlockParams, w: number, h: number, seed = 9) {
    let s = seed >>> 0 || 1;
    this.rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    this.n = birds.length;
    this.w = w;
    this.h = h;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.group = Int32Array.from(birds, (b) => b.group);
    this.size = Float32Array.from(birds, (b) => b.size);
    this.groups = params.pace.length;
    this.params = params;
    this.cx = new Float32Array(this.groups);
    this.cy = new Float32Array(this.groups);
    this.count = new Int32Array(this.groups);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = MARGIN + this.rand() * Math.max(1, w - 2 * MARGIN);
      this.y[i] = MARGIN + this.rand() * Math.max(1, h - 2 * MARGIN);
      const a = this.rand() * Math.PI * 2;
      this.vx[i] = Math.cos(a) * BASE_SPEED;
      this.vy[i] = Math.sin(a) * BASE_SPEED;
    }
  }

  /** New groups (a regrouping): every bird keeps its place and heading, and
   *  the new cohesion gathers them into new flocks over the next seconds. */
  regroup(groups: number[], params: FlockParams) {
    this.group = Int32Array.from(groups);
    this.params = params;
    this.groups = params.pace.length;
    this.cx = new Float32Array(this.groups);
    this.cy = new Float32Array(this.groups);
    this.count = new Int32Array(this.groups);
  }

  /** Take another flock's birds' places, as far as they go, so a new data set
   *  flies on from the old picture. The rest enter from the edges. */
  inherit(from: Flock) {
    for (let i = 0; i < this.n; i++) {
      if (i < from.n) {
        this.x[i] = (from.x[i] / from.w) * this.w;
        this.y[i] = (from.y[i] / from.h) * this.h;
        this.vx[i] = from.vx[i];
        this.vy[i] = from.vy[i];
      } else {
        const side = Math.floor(this.rand() * 4);
        this.x[i] = side === 0 ? 2 : side === 1 ? this.w - 2 : this.rand() * this.w;
        this.y[i] = side === 2 ? 2 : side === 3 ? this.h - 2 : this.rand() * this.h;
        this.vx[i] = (this.w / 2 - this.x[i]) * 0.01;
        this.vy[i] = (this.h / 2 - this.y[i]) * 0.01;
      }
    }
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = (this.x[i] / this.w) * w;
      this.y[i] = (this.y[i] / this.h) * h;
    }
    this.w = w;
    this.h = h;
  }

  /** One step. `pointer` (canvas px) is the predator, or null. */
  step(pointer: { x: number; y: number } | null = null) {
    const { n, x, y, vx, vy, group, w, h } = this;
    const G = this.groups;

    // Group centres.
    this.cx.fill(0);
    this.cy.fill(0);
    this.count.fill(0);
    for (let i = 0; i < n; i++) {
      const g = group[i];
      this.cx[g] += x[i];
      this.cy[g] += y[i];
      this.count[g]++;
    }
    for (let g = 0; g < G; g++) {
      if (this.count[g]) {
        this.cx[g] /= this.count[g];
        this.cy[g] /= this.count[g];
      }
    }

    // Per group, once: its roaming goal, the pull of related groups and the
    // push of unrelated ones. Every bird of the group gets the same nudge.
    this.t++;
    const gx = new Float32Array(G);
    const gy = new Float32Array(G);
    for (let g = 0; g < G; g++) {
      if (!this.count[g]) continue;
      const ph = g * 2.399; // golden angle: goals start spread out
      const goalX = w / 2 + w * 0.34 * Math.cos(this.t * (0.0021 + 0.00023 * (g % 5)) + ph);
      const goalY = h / 2 + h * 0.32 * Math.sin(this.t * (0.0017 + 0.00019 * (g % 7)) + ph * 1.7);
      gx[g] += (goalX - this.cx[g]) * 0.0011;
      gy[g] += (goalY - this.cy[g]) * 0.0011;
      const aff = this.params.affinity[g];
      for (let k = 0; k < G; k++) {
        if (k === g || !this.count[k]) continue;
        const a = aff?.[k] ?? 0;
        const dx = this.cx[g] - this.cx[k];
        const dy = this.cy[g] - this.cy[k];
        const d = Math.hypot(dx, dy) || 1e-3;
        gx[g] -= dx * 0.00025 * a;
        gy[g] -= dy * 0.00025 * a;
        if (d < SHY) {
          const push = (1 - a) * 0.05 * (1 - d / SHY);
          gx[g] += (dx / d) * push;
          gy[g] += (dy / d) * push;
        }
      }
    }

    // A grid of cells R wide, so each bird looks at its neighbours only.
    const cols = Math.max(1, Math.ceil(w / R));
    const rows = Math.max(1, Math.ceil(h / R));
    const head = new Int32Array(cols * rows).fill(-1);
    const next = new Int32Array(n);
    const cellOf = (i: number) =>
      Math.min(rows - 1, Math.max(0, Math.floor(y[i] / R))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x[i] / R)));
    for (let i = 0; i < n; i++) {
      const c = cellOf(i);
      next[i] = head[c];
      head[c] = i;
    }

    const ax = new Float32Array(n);
    const ay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = group[i];
      let sx = 0;
      let sy = 0;
      let alx = 0;
      let aly = 0;
      let cox = 0;
      let coy = 0;
      let same = 0;
      const ccol = Math.min(cols - 1, Math.max(0, Math.floor(x[i] / R)));
      const crow = Math.min(rows - 1, Math.max(0, Math.floor(y[i] / R)));
      for (let dr = -1; dr <= 1; dr++) {
        const r = crow + dr;
        if (r < 0 || r >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const c = ccol + dc;
          if (c < 0 || c >= cols) continue;
          for (let j = head[r * cols + c]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const d2 = dx * dx + dy * dy;
            if (d2 > R * R) continue;
            if (d2 < SEP * SEP && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              sx -= dx / d / d;
              sy -= dy / d / d;
            }
            if (group[j] === g) {
              alx += vx[j];
              aly += vy[j];
              cox += dx;
              coy += dy;
              same++;
            }
          }
        }
      }
      let fx = sx * 1.6;
      let fy = sy * 1.6;
      if (same) {
        fx += (alx / same - vx[i]) * 0.06 + (cox / same) * 0.004;
        fy += (aly / same - vy[i]) * 0.06 + (coy / same) * 0.004;
      }
      // The whole group's centre, gently, so a group becomes one flock;
      // then the group's own roaming, affinity and shyness.
      fx += (this.cx[g] - x[i]) * 0.0006 + gx[g];
      fy += (this.cy[g] - y[i]) * 0.0006 + gy[g];
      // The pointer is a hawk.
      if (pointer) {
        const dx = x[i] - pointer.x;
        const dy = y[i] - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 90 * 90 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          fx += (dx / d) * (1 - d / 90) * 0.9;
          fy += (dy / d) * (1 - d / 90) * 0.9;
        }
      }
      // Soft walls.
      if (x[i] < MARGIN) fx += (MARGIN - x[i]) * 0.01;
      if (x[i] > w - MARGIN) fx -= (x[i] - (w - MARGIN)) * 0.01;
      if (y[i] < MARGIN) fy += (MARGIN - y[i]) * 0.01;
      if (y[i] > h - MARGIN) fy -= (y[i] - (h - MARGIN)) * 0.01;
      // A little wander keeps it alive.
      fx += (this.rand() - 0.5) * 0.05;
      fy += (this.rand() - 0.5) * 0.05;
      ax[i] = fx;
      ay[i] = fy;
    }

    for (let i = 0; i < n; i++) {
      vx[i] += ax[i];
      vy[i] += ay[i];
      const top = BASE_SPEED * (this.params.pace[group[i]] ?? 1);
      const sp = Math.hypot(vx[i], vy[i]) || 1e-6;
      const k = sp > top ? top / sp : sp < MIN_SPEED ? MIN_SPEED / sp : 1;
      vx[i] *= k;
      vy[i] *= k;
      x[i] = Math.max(0, Math.min(w, x[i] + vx[i]));
      y[i] = Math.max(0, Math.min(h, y[i] + vy[i]));
    }
  }
}

// ---- from rows to flock -------------------------------------------------

export interface FlockItem {
  /** What it flocks by (a job, a division, a vendor…). */
  key: string;
  /** What links groups together (vendors for jobs, jobs for vendors…). */
  link: string;
  value: number;
  /** "YYYY-MM-DD", or "" when the row has no date. */
  date: string;
}

export interface FlockSetup {
  /** Group names, biggest first. Past MAX_GROUPS, the rest fold into "Other". */
  names: string[];
  totals: number[];
  birds: FlockBirdInit[];
  params: FlockParams;
}

/** Eight colours plus "Other". */
export const MAX_GROUPS = 9;
export const OTHER = "Other";

/** Rows → groups, bird sizes, each group's pace and the affinity between groups. */
export function flockSetup(items: FlockItem[]): FlockSetup {
  const totals = new Map<string, number>();
  for (const it of items) totals.set(it.key, (totals.get(it.key) ?? 0) + Math.abs(it.value));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const kept = ranked.slice(0, MAX_GROUPS - (ranked.length > MAX_GROUPS ? 1 : 0)).map(([k]) => k);
  const names = ranked.length > kept.length ? [...kept, OTHER] : kept;
  const index = new Map(kept.map((k, i) => [k, i]));
  const gOf = (k: string) => index.get(k) ?? names.length - 1;

  const G = names.length;
  const groupTotals = new Array(G).fill(0);
  const links: Set<string>[] = Array.from({ length: G }, () => new Set());
  const recent = new Array(G).fill(0);
  const dates = items.map((i) => i.date).filter(Boolean).sort();
  const last = dates[dates.length - 1] ?? "";
  const cutoff = last ? new Date(Date.parse(last) - 45 * 86_400_000).toISOString().slice(0, 10) : "";

  const maxLog = Math.max(1e-6, ...items.map((i) => Math.log10(1 + Math.abs(i.value))));
  const birds = items.map((it) => {
    const g = gOf(it.key);
    groupTotals[g] += Math.abs(it.value);
    if (it.link) links[g].add(it.link);
    if (!cutoff || (it.date && it.date >= cutoff)) recent[g] += Math.abs(it.value);
    return { group: g, size: Math.log10(1 + Math.abs(it.value)) / maxLog };
  });

  // Pace: the share of a group's value that fell in the last 45 days, mapped
  // to 0.6 (quiet) .. 1.6 (busy). With no dates, every group flies at 1.
  const share = recent.map((r, g) => (groupTotals[g] ? r / groupTotals[g] : 0));
  const topShare = Math.max(1e-6, ...share);
  const pace = share.map((s) => (dates.length ? 0.6 + (s / topShare) : 1));

  // Affinity: Jaccard overlap of the groups' link sets.
  const affinity = links.map((a, g) =>
    links.map((b, h) => {
      if (g === h || !a.size || !b.size) return 0;
      let both = 0;
      for (const v of a) if (b.has(v)) both++;
      return both / (a.size + b.size - both);
    }),
  );
  return { names, totals: groupTotals, birds, params: { pace, affinity } };
}
