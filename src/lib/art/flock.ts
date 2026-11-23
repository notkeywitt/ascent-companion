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
 * Two kinds of edge (`wrap`). Walls, the default: a bird near an edge is
 * turned back. Wrap around: a bird that leaves one edge comes in at the
 * opposite one, and every distance is measured the short way round, so a
 * flock crossing an edge stays one flock (its centre is a circular mean).
 *
 * Birds can be born and die (the year mode): `setTargets` gives each bird a
 * target opacity. A bird fading in is born beside its own flock (or enters at
 * an edge if its flock is empty); a bird at zero sits out of every rule.
 */

export interface FlockBirdInit {
  group: number;
  /** 0..1, how big the bird draws (from its row's value). */
  size: number;
  /** Each bird's own small differences (owner, 2026-11-17), about 0.85..1.15:
   *  its drawn scale, its top speed and how far it sees. Missing means 1. */
  scale?: number;
  speed?: number;
  sight?: number;
  /** -1..1, a shift of the bird's hue within its flock's colour, from its
   *  row's link (the vendor of a job's bill line, say). Missing means 0. */
  shade?: number;
}

/** The largest `sight` a bird can have; the neighbour grid is sized for it. */
export const MAX_SIGHT = 1.15;

export interface FlockParams {
  /** Groups' top-speed factors, about 0.6..1.6. */
  pace: number[];
  /** affinity[g][h], 0..1: how much group g is drawn to group h. */
  affinity: number[][];
}

const R = 34; // how far a bird sees its own flock
const SEP = 13; // how close is too close
const SHY = 170; // unrelated flocks keep about this far apart
const BASE_SPEED = 1.3; // px per step at pace 1
const MIN_SPEED = 0.45;
const MARGIN = 36;
const CELL = R * MAX_SIGHT;

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
  /** Per bird: top-speed factor, sight factor, drawn scale and hue shade. */
  speed: Float32Array;
  sight: Float32Array;
  scale: Float32Array;
  shade: Float32Array;
  groups: number;
  params: FlockParams;
  /** Each group's centre and count, refreshed every step. */
  cx: Float32Array;
  cy: Float32Array;
  count: Int32Array;
  /** Steps taken; drives each group's roaming goal. */
  t = 0;
  /** Each bird's opacity now, and where it is heading (1 = alive). */
  alpha: Float32Array;
  target: Float32Array;
  /** 1 for a bird taking part this step. */
  live: Uint8Array;
  /** 1 for a bird born this step (a drawing resets its trail). */
  born: Uint8Array;
  /** Wrap around at the edges instead of turning back at walls. */
  wrap = false;
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
    this.speed = Float32Array.from(birds, (b) => b.speed ?? 1);
    this.sight = Float32Array.from(birds, (b) => Math.min(MAX_SIGHT, b.sight ?? 1));
    this.scale = Float32Array.from(birds, (b) => b.scale ?? 1);
    this.shade = Float32Array.from(birds, (b) => b.shade ?? 0);
    this.groups = params.pace.length;
    this.params = params;
    this.cx = new Float32Array(this.groups);
    this.cy = new Float32Array(this.groups);
    this.count = new Int32Array(this.groups);
    this.alpha = new Float32Array(this.n).fill(1);
    this.target = new Float32Array(this.n).fill(1);
    this.live = new Uint8Array(this.n).fill(1);
    this.born = new Uint8Array(this.n);
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

  /** Target opacities (0 = gone, 1 = alive), one per bird. A bird at zero
   *  with a target above it is born next step. */
  setTargets(t: ArrayLike<number>) {
    for (let i = 0; i < this.n; i++) this.target[i] = t[i] ?? 1;
  }

  /** Every bird alive at once, at full opacity (the whole-year view). */
  allAlive() {
    this.target.fill(1);
    this.alpha.fill(1);
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
    const { n, x, y, vx, vy, group, w, h, wrap } = this;
    const G = this.groups;
    // From a to b along one axis: the short way round when the edges wrap.
    const dX = (a: number, b: number) => {
      const d = b - a;
      return !wrap ? d : d > w / 2 ? d - w : d < -w / 2 ? d + w : d;
    };
    const dY = (a: number, b: number) => {
      const d = b - a;
      return !wrap ? d : d > h / 2 ? d - h : d < -h / 2 ? d + h : d;
    };
    const into = (v: number, size: number) => (wrap ? ((v % size) + size) % size : Math.max(0, Math.min(size, v)));

    // Births and deaths. A bird being born appears beside its flock, using
    // the centres from the step before.
    const live = this.live;
    this.born.fill(0);
    for (let i = 0; i < n; i++) {
      const tgt = this.target[i];
      if (this.alpha[i] <= 0.02 && tgt > 0.02) {
        this.born[i] = 1;
        const g = group[i];
        if (this.count[g] > 0) {
          const a = this.rand() * Math.PI * 2;
          const r = 8 + this.rand() * 26;
          x[i] = into(this.cx[g] + Math.cos(a) * r, w);
          y[i] = into(this.cy[g] + Math.sin(a) * r, h);
        } else {
          const side = Math.floor(this.rand() * 4);
          x[i] = side === 0 ? 2 : side === 1 ? w - 2 : this.rand() * w;
          y[i] = side === 2 ? 2 : side === 3 ? h - 2 : this.rand() * h;
        }
        this.alpha[i] = 0.03;
      }
      this.alpha[i] += (tgt - this.alpha[i]) * 0.06;
      live[i] = this.alpha[i] > 0.02 ? 1 : 0;
    }

    // Group centres, over the live birds. With wrapping edges a plain mean
    // would put a flock that straddles an edge in the middle of the screen,
    // so each axis is averaged as an angle around its circle instead.
    this.cx.fill(0);
    this.cy.fill(0);
    this.count.fill(0);
    const sxC = new Float32Array(G);
    const sxS = new Float32Array(G);
    const syC = new Float32Array(G);
    const syS = new Float32Array(G);
    const TAU = Math.PI * 2;
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      const g = group[i];
      if (wrap) {
        sxC[g] += Math.cos((x[i] / w) * TAU);
        sxS[g] += Math.sin((x[i] / w) * TAU);
        syC[g] += Math.cos((y[i] / h) * TAU);
        syS[g] += Math.sin((y[i] / h) * TAU);
      } else {
        this.cx[g] += x[i];
        this.cy[g] += y[i];
      }
      this.count[g]++;
    }
    for (let g = 0; g < G; g++) {
      if (!this.count[g]) continue;
      if (wrap) {
        this.cx[g] = into((Math.atan2(sxS[g], sxC[g]) / TAU) * w, w);
        this.cy[g] = into((Math.atan2(syS[g], syC[g]) / TAU) * h, h);
      } else {
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
      // Walls: a slow loop around the middle. Wrap: a steady drift in the
      // group's own direction, so flocks travel off one edge and back in.
      const goalX = wrap
        ? into(w * ((g * 0.37) % 1) + this.t * Math.cos(ph) * 0.45, w)
        : w / 2 + w * 0.34 * Math.cos(this.t * (0.0021 + 0.00023 * (g % 5)) + ph);
      const goalY = wrap
        ? into(h * ((g * 0.61) % 1) + this.t * Math.sin(ph) * 0.3 + h * 0.08 * Math.sin(this.t * 0.004 + ph), h)
        : h / 2 + h * 0.32 * Math.sin(this.t * (0.0017 + 0.00019 * (g % 7)) + ph * 1.7);
      gx[g] += dX(this.cx[g], goalX) * 0.0011;
      gy[g] += dY(this.cy[g], goalY) * 0.0011;
      const aff = this.params.affinity[g];
      for (let k = 0; k < G; k++) {
        if (k === g || !this.count[k]) continue;
        const a = aff?.[k] ?? 0;
        const dx = dX(this.cx[k], this.cx[g]);
        const dy = dY(this.cy[k], this.cy[g]);
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

    // A grid of cells CELL wide (the farthest any bird sees), so each bird
    // looks at its neighbours only.
    const cols = Math.max(1, Math.ceil(w / CELL));
    const rows = Math.max(1, Math.ceil(h / CELL));
    const head = new Int32Array(cols * rows).fill(-1);
    const next = new Int32Array(n);
    const cellOf = (i: number) =>
      Math.min(rows - 1, Math.max(0, Math.floor(y[i] / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x[i] / CELL)));
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      const c = cellOf(i);
      next[i] = head[c];
      head[c] = i;
    }

    const ax = new Float32Array(n);
    const ay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      const g = group[i];
      let sx = 0;
      let sy = 0;
      let alx = 0;
      let aly = 0;
      let cox = 0;
      let coy = 0;
      let same = 0;
      const r2 = (R * this.sight[i]) ** 2;
      const ccol = Math.min(cols - 1, Math.max(0, Math.floor(x[i] / CELL)));
      const crow = Math.min(rows - 1, Math.max(0, Math.floor(y[i] / CELL)));
      // With wrapping edges the neighbouring cells wrap too (when the grid is
      // at least three cells across, so no cell is visited twice).
      const wrapC = wrap && cols >= 3;
      const wrapR = wrap && rows >= 3;
      for (let dr = -1; dr <= 1; dr++) {
        let r = crow + dr;
        if (wrapR) r = (r + rows) % rows;
        else if (r < 0 || r >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          let c = ccol + dc;
          if (wrapC) c = (c + cols) % cols;
          else if (c < 0 || c >= cols) continue;
          for (let j = head[r * cols + c]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = dX(x[i], x[j]);
            const dy = dY(y[i], y[j]);
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
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
      fx += dX(x[i], this.cx[g]) * 0.0006 + gx[g];
      fy += dY(y[i], this.cy[g]) * 0.0006 + gy[g];
      // The pointer is a hawk.
      if (pointer) {
        const dx = dX(pointer.x, x[i]);
        const dy = dY(pointer.y, y[i]);
        const d2 = dx * dx + dy * dy;
        if (d2 < 90 * 90 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          fx += (dx / d) * (1 - d / 90) * 0.9;
          fy += (dy / d) * (1 - d / 90) * 0.9;
        }
      }
      // Soft walls, unless the edges wrap.
      if (!wrap) {
        if (x[i] < MARGIN) fx += (MARGIN - x[i]) * 0.01;
        if (x[i] > w - MARGIN) fx -= (x[i] - (w - MARGIN)) * 0.01;
        if (y[i] < MARGIN) fy += (MARGIN - y[i]) * 0.01;
        if (y[i] > h - MARGIN) fy -= (y[i] - (h - MARGIN)) * 0.01;
      }
      // A little wander keeps it alive.
      fx += (this.rand() - 0.5) * 0.05;
      fy += (this.rand() - 0.5) * 0.05;
      ax[i] = fx;
      ay[i] = fy;
    }

    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      vx[i] += ax[i];
      vy[i] += ay[i];
      const top = BASE_SPEED * (this.params.pace[group[i]] ?? 1) * this.speed[i];
      const sp = Math.hypot(vx[i], vy[i]) || 1e-6;
      const k = sp > top ? top / sp : sp < MIN_SPEED ? MIN_SPEED / sp : 1;
      vx[i] *= k;
      vy[i] *= k;
      x[i] = into(x[i] + vx[i], w);
      y[i] = into(y[i] + vy[i], h);
    }
  }
}

// ---- from rows to flock -------------------------------------------------

/** 0..1 from a bird's index and a salt: a fixed, even spread. */
function unit(i: number, salt: number): number {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 0..1 from a string: the same link always gets the same shade. */
function unitOf(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return unit(h >>> 0, 7);
}

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
  const birds = items.map((it, i): FlockBirdInit => {
    const g = gOf(it.key);
    groupTotals[g] += Math.abs(it.value);
    if (it.link) links[g].add(it.link);
    if (!cutoff || (it.date && it.date >= cutoff)) recent[g] += Math.abs(it.value);
    return {
      group: g,
      size: Math.log10(1 + Math.abs(it.value)) / maxLog,
      // Small, fixed differences per bird: the same bird is the same every load.
      scale: 0.85 + 0.3 * unit(i, 1),
      speed: 0.85 + 0.3 * unit(i, 2),
      sight: 0.85 + 0.3 * unit(i, 3),
      shade: it.link ? unitOf(it.link) * 2 - 1 : 0,
    };
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

// ---- the year ------------------------------------------------------------

/** How long a row's bird lives after its date, in days. */
export const LIFE_DAYS = 35;

export interface YearClock {
  /** Day number (days since 1970) of the first dated row. */
  start: number;
  /** Days from the first dated row to the last. */
  span: number;
  /** Each item's day offset from `start`; NaN for an undated row. */
  days: Float64Array;
}

const dayNumber = (iso: string) => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : NaN;
};

export function yearClock(items: { date: string }[]): YearClock {
  const nums = items.map((i) => (i.date ? dayNumber(i.date) : NaN));
  const known = nums.filter((d) => Number.isFinite(d));
  const start = known.length ? Math.min(...known) : 0;
  const end = known.length ? Math.max(...known) : 0;
  return { start, span: end - start, days: Float64Array.from(nums, (d) => d - start) };
}

/**
 * Target opacities at `t` days into the clock: a dated bird is alive from its
 * day for LIFE_DAYS; an undated one is always alive. The loop runs from 0 to
 * span + LIFE_DAYS, so the year's last birds live out their time before the
 * first ones are born again.
 */
export function aliveAt(
  clock: YearClock,
  t: number,
  out: Float32Array<ArrayBuffer> = new Float32Array(clock.days.length),
): Float32Array<ArrayBuffer> {
  for (let i = 0; i < clock.days.length; i++) {
    const d = clock.days[i];
    out[i] = Number.isNaN(d) ? 1 : t >= d && t < d + LIFE_DAYS ? 1 : 0;
  }
  return out;
}

/** The loop's length in days. */
export const loopDays = (clock: YearClock) => clock.span + LIFE_DAYS;

/** "Jun 2026" for `t` days into the clock. */
export function clockLabel(clock: YearClock, t: number): string {
  const d = new Date((clock.start + Math.floor(t)) * 86_400_000);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Month starts within the loop, as [day offset, "Jun"]. */
export function monthTicks(clock: YearClock): [number, string][] {
  const out: [number, string][] = [];
  const first = new Date(clock.start * 86_400_000);
  let y = first.getUTCFullYear();
  let m = first.getUTCMonth() + 1;
  for (;;) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const day = Date.UTC(y, m, 1) / 86_400_000 - clock.start;
    if (day > loopDays(clock)) break;
    out.push([day, new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })]);
    m++;
  }
  return out;
}
