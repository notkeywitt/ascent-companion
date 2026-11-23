/**
 * The Job Flock in three dimensions (/art/flock, Space: 3D). The same rules
 * as the flat flock (src/lib/art/flock.ts), with a third axis: separation,
 * alignment and cohesion within a group, a roaming goal per group, affinity
 * and shyness between groups, a pace per group, births and deaths for the
 * year mode, and the pointer as a hawk (a point in the box).
 *
 * The world is a box of size sx × sy × sz in its own units (a cube of side
 * SIDE by default; the Tank view makes it wide and shallow); the page's camera
 * (camera3d.ts) projects it onto the canvas. Walls turn birds back inside the
 * box; wrap sends a bird that leaves one face in at the opposite one.
 * Pure: no DOM.
 */
import { MAX_SIGHT, type FlockBirdInit, type FlockParams } from "./flock";

export const SIDE = 1000;
const R = 58; // how far a bird sees its own flock
const SEP = 32; // how close is too close (loose flocks fill the box: owner, 2026-11-17)
const SHY = 280; // unrelated flocks keep about this far apart
const BASE_SPEED = 2.1;
const MIN_SPEED = 0.72;
const MARGIN = 70;
const CELL = R * MAX_SIGHT;

export class Flock3D {
  n: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  group: Int32Array;
  size: Float32Array;
  /** Per bird: top-speed factor, sight factor, drawn scale and hue shade. */
  speed: Float32Array;
  sight: Float32Array;
  scale: Float32Array;
  shade: Float32Array;
  groups: number;
  params: FlockParams;
  cx: Float32Array;
  cy: Float32Array;
  cz: Float32Array;
  count: Int32Array;
  alpha: Float32Array;
  target: Float32Array;
  live: Uint8Array;
  born: Uint8Array;
  wrap = false;
  t = 0;
  /** The box's size along each axis. */
  sx = SIDE;
  sy = SIDE;
  sz = SIDE;
  private rand: () => number;

  constructor(birds: FlockBirdInit[], params: FlockParams, seed = 13) {
    let s = seed >>> 0 || 1;
    this.rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const n = (this.n = birds.length);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
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
    this.cz = new Float32Array(this.groups);
    this.count = new Int32Array(this.groups);
    this.alpha = new Float32Array(n).fill(1);
    this.target = new Float32Array(n).fill(1);
    this.live = new Uint8Array(n).fill(1);
    this.born = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = MARGIN + this.rand() * (SIDE - 2 * MARGIN);
      this.y[i] = MARGIN + this.rand() * (SIDE - 2 * MARGIN);
      this.z[i] = MARGIN + this.rand() * (SIDE - 2 * MARGIN);
      const a = this.rand() * Math.PI * 2;
      const b = (this.rand() - 0.5) * Math.PI;
      this.vx[i] = Math.cos(a) * Math.cos(b) * BASE_SPEED;
      this.vy[i] = Math.sin(b) * BASE_SPEED;
      this.vz[i] = Math.sin(a) * Math.cos(b) * BASE_SPEED;
    }
  }

  regroup(groups: number[], params: FlockParams) {
    this.group = Int32Array.from(groups);
    this.params = params;
    this.groups = params.pace.length;
    this.cx = new Float32Array(this.groups);
    this.cy = new Float32Array(this.groups);
    this.cz = new Float32Array(this.groups);
    this.count = new Int32Array(this.groups);
  }

  /** Change the box's size; every bird keeps its place as a share of it. */
  resize(sx: number, sy: number, sz: number) {
    if (sx === this.sx && sy === this.sy && sz === this.sz) return;
    for (let i = 0; i < this.n; i++) {
      this.x[i] *= sx / this.sx;
      this.y[i] *= sy / this.sy;
      this.z[i] *= sz / this.sz;
    }
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
  }

  /**
   * Start from a flat picture: each bird keeps its place across and down
   * (as a share of the canvas), on a thin sheet through the middle of the
   * box, so the flock lifts off the page into depth.
   */
  fromFlat(xs: ArrayLike<number>, ys: ArrayLike<number>, w: number, h: number, vxs: ArrayLike<number>, vys: ArrayLike<number>) {
    for (let i = 0; i < this.n && i < xs.length; i++) {
      this.x[i] = (xs[i] / w) * this.sx;
      this.y[i] = (1 - ys[i] / h) * this.sy;
      this.z[i] = this.sz / 2 + (this.rand() - 0.5) * 30;
      this.vx[i] = vxs[i] * 1.5;
      this.vy[i] = -vys[i] * 1.5;
      this.vz[i] = (this.rand() - 0.5) * 0.8;
    }
  }

  /** Take another 3D flock's birds' places, as far as they go. */
  inherit(from: Flock3D) {
    for (let i = 0; i < this.n && i < from.n; i++) {
      this.x[i] = (from.x[i] / from.sx) * this.sx;
      this.y[i] = (from.y[i] / from.sy) * this.sy;
      this.z[i] = (from.z[i] / from.sz) * this.sz;
      this.vx[i] = from.vx[i];
      this.vy[i] = from.vy[i];
      this.vz[i] = from.vz[i];
    }
  }

  setTargets(t: ArrayLike<number>) {
    for (let i = 0; i < this.n; i++) this.target[i] = t[i] ?? 1;
  }

  allAlive() {
    this.target.fill(1);
    this.alpha.fill(1);
  }

  /** One step. `hawk` is a point in the box, or null. */
  step(hawk: { x: number; y: number; z: number } | null = null) {
    const { n, x, y, z, vx, vy, vz, group, wrap } = this;
    const G = this.groups;
    const BX = this.sx;
    const BY = this.sy;
    const BZ = this.sz;
    // From a to b along one axis of size `size`: the short way round when wrapping.
    const dd1 = (a: number, b: number, size: number) => {
      const d = b - a;
      return !wrap ? d : d > size / 2 ? d - size : d < -size / 2 ? d + size : d;
    };
    const dX = (a: number, b: number) => dd1(a, b, BX);
    const dY = (a: number, b: number) => dd1(a, b, BY);
    const dZ = (a: number, b: number) => dd1(a, b, BZ);
    const inA = (v: number, size: number) => (wrap ? ((v % size) + size) % size : Math.max(0, Math.min(size, v)));
    const inX = (v: number) => inA(v, BX);
    const inY = (v: number) => inA(v, BY);
    const inZ = (v: number) => inA(v, BZ);

    // Births and deaths.
    const live = this.live;
    this.born.fill(0);
    for (let i = 0; i < n; i++) {
      const tgt = this.target[i];
      if (this.alpha[i] <= 0.02 && tgt > 0.02) {
        this.born[i] = 1;
        const g = group[i];
        if (this.count[g] > 0) {
          x[i] = inX(this.cx[g] + (this.rand() - 0.5) * 70);
          y[i] = inY(this.cy[g] + (this.rand() - 0.5) * 70);
          z[i] = inZ(this.cz[g] + (this.rand() - 0.5) * 70);
        } else {
          x[i] = this.rand() * BX;
          y[i] = this.rand() * BY;
          z[i] = this.rand() < 0.5 ? 4 : BZ - 4;
        }
        this.alpha[i] = 0.03;
      }
      this.alpha[i] += (tgt - this.alpha[i]) * 0.06;
      live[i] = this.alpha[i] > 0.02 ? 1 : 0;
    }

    // Group centres (a circular mean per axis when the box wraps).
    const TAU = Math.PI * 2;
    const acc = new Float32Array(G * 6);
    this.count.fill(0);
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      const g = group[i];
      const o = g * 6;
      if (wrap) {
        acc[o] += Math.cos((x[i] / BX) * TAU);
        acc[o + 1] += Math.sin((x[i] / BX) * TAU);
        acc[o + 2] += Math.cos((y[i] / BY) * TAU);
        acc[o + 3] += Math.sin((y[i] / BY) * TAU);
        acc[o + 4] += Math.cos((z[i] / BZ) * TAU);
        acc[o + 5] += Math.sin((z[i] / BZ) * TAU);
      } else {
        acc[o] += x[i];
        acc[o + 2] += y[i];
        acc[o + 4] += z[i];
      }
      this.count[g]++;
    }
    for (let g = 0; g < G; g++) {
      const c = this.count[g];
      if (!c) continue;
      const o = g * 6;
      if (wrap) {
        this.cx[g] = inX((Math.atan2(acc[o + 1], acc[o]) / TAU) * BX);
        this.cy[g] = inY((Math.atan2(acc[o + 3], acc[o + 2]) / TAU) * BY);
        this.cz[g] = inZ((Math.atan2(acc[o + 5], acc[o + 4]) / TAU) * BZ);
      } else {
        this.cx[g] = acc[o] / c;
        this.cy[g] = acc[o + 2] / c;
        this.cz[g] = acc[o + 4] / c;
      }
    }

    // Per group: roaming goal, affinity and shyness.
    this.t++;
    const gv = new Float32Array(G * 3);
    for (let g = 0; g < G; g++) {
      if (!this.count[g]) continue;
      const ph = g * 2.399;
      const t = this.t;
      const goal = wrap
        ? [
            inX(BX * ((g * 0.37) % 1) + t * Math.cos(ph) * 0.7),
            inY(BY * ((g * 0.61) % 1) + t * Math.sin(ph * 1.3) * 0.4),
            inZ(BZ * ((g * 0.23) % 1) + t * Math.sin(ph) * 0.7),
          ]
        : [
            // Wide loops (owner, 2026-11-17): the flocks use most of the box.
            BX / 2 + BX * 0.33 * Math.cos(t * (0.0019 + 0.0002 * (g % 5)) + ph),
            BY / 2 + BY * 0.3 * Math.sin(t * (0.0013 + 0.00017 * (g % 7)) + ph * 1.7),
            BZ / 2 + BZ * 0.3 * Math.sin(t * (0.0016 + 0.00021 * (g % 3)) + ph * 0.6),
          ];
      gv[g * 3] += dX(this.cx[g], goal[0]) * 0.0016;
      gv[g * 3 + 1] += dY(this.cy[g], goal[1]) * 0.0016;
      gv[g * 3 + 2] += dZ(this.cz[g], goal[2]) * 0.0016;
      const aff = this.params.affinity[g];
      for (let k = 0; k < G; k++) {
        if (k === g || !this.count[k]) continue;
        const a = aff?.[k] ?? 0;
        const dx = dX(this.cx[k], this.cx[g]);
        const dy = dY(this.cy[k], this.cy[g]);
        const dz = dZ(this.cz[k], this.cz[g]);
        const d = Math.hypot(dx, dy, dz) || 1e-3;
        gv[g * 3] -= dx * 0.00025 * a;
        gv[g * 3 + 1] -= dy * 0.00025 * a;
        gv[g * 3 + 2] -= dz * 0.00025 * a;
        if (d < SHY) {
          const push = (1 - a) * 0.07 * (1 - d / SHY);
          gv[g * 3] += (dx / d) * push;
          gv[g * 3 + 1] += (dy / d) * push;
          gv[g * 3 + 2] += (dz / d) * push;
        }
      }
    }

    // A 3-D grid of cells CELL wide.
    const cxN = Math.max(1, Math.ceil(BX / CELL));
    const cyN = Math.max(1, Math.ceil(BY / CELL));
    const czN = Math.max(1, Math.ceil(BZ / CELL));
    const head = new Int32Array(cxN * cyN * czN).fill(-1);
    const next = new Int32Array(n);
    const cOf = (v: number, cells: number) => Math.min(cells - 1, Math.max(0, Math.floor(v / CELL)));
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      const c = (cOf(z[i], czN) * cyN + cOf(y[i], cyN)) * cxN + cOf(x[i], cxN);
      next[i] = head[c];
      head[c] = i;
    }
    const wrapX = wrap && cxN >= 3;
    const wrapY = wrap && cyN >= 3;
    const wrapZ = wrap && czN >= 3;

    const ax = new Float32Array(n);
    const ay = new Float32Array(n);
    const az = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      const g = group[i];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let alx = 0;
      let aly = 0;
      let alz = 0;
      let cox = 0;
      let coy = 0;
      let coz = 0;
      let same = 0;
      const r2 = (R * this.sight[i]) ** 2;
      const ci = cOf(x[i], cxN);
      const cj = cOf(y[i], cyN);
      const ck = cOf(z[i], czN);
      for (let dk = -1; dk <= 1; dk++) {
        let k = ck + dk;
        if (wrapZ) k = (k + czN) % czN;
        else if (k < 0 || k >= czN) continue;
        for (let dj = -1; dj <= 1; dj++) {
          let jj = cj + dj;
          if (wrapY) jj = (jj + cyN) % cyN;
          else if (jj < 0 || jj >= cyN) continue;
          for (let di = -1; di <= 1; di++) {
            let ii = ci + di;
            if (wrapX) ii = (ii + cxN) % cxN;
            else if (ii < 0 || ii >= cxN) continue;
            for (let j = head[(k * cyN + jj) * cxN + ii]; j !== -1; j = next[j]) {
              if (j === i) continue;
              const dx = dX(x[i], x[j]);
              const dy = dY(y[i], y[j]);
              const dz = dZ(z[i], z[j]);
              const dd = dx * dx + dy * dy + dz * dz;
              if (dd > r2) continue;
              if (dd < SEP * SEP && dd > 1e-6) {
                const d = Math.sqrt(dd);
                sx -= dx / d / d;
                sy -= dy / d / d;
                sz -= dz / d / d;
              }
              if (group[j] === g) {
                alx += vx[j];
                aly += vy[j];
                alz += vz[j];
                cox += dx;
                coy += dy;
                coz += dz;
                same++;
              }
            }
          }
        }
      }
      let fx = sx * 2.4;
      let fy = sy * 2.4;
      let fz = sz * 2.4;
      if (same) {
        fx += (alx / same - vx[i]) * 0.06 + (cox / same) * 0.003;
        fy += (aly / same - vy[i]) * 0.06 + (coy / same) * 0.003;
        fz += (alz / same - vz[i]) * 0.06 + (coz / same) * 0.003;
      }
      // Close flocks (owner, 2026-11-16): a firm pull to the group's centre,
      // and the roaming goals stay near the middle of the box, so flocks hold
      // together and stay near each other.
      fx += dX(x[i], this.cx[g]) * 0.00045 + gv[g * 3];
      fy += dY(y[i], this.cy[g]) * 0.00045 + gv[g * 3 + 1];
      fz += dZ(z[i], this.cz[g]) * 0.00045 + gv[g * 3 + 2];
      if (hawk) {
        const dx = dX(hawk.x, x[i]);
        const dy = dY(hawk.y, y[i]);
        const dz = dZ(hawk.z, z[i]);
        const dd = dx * dx + dy * dy + dz * dz;
        const HR = 150;
        if (dd < HR * HR && dd > 1e-6) {
          const d = Math.sqrt(dd);
          const k = (1 - d / HR) * 1.3;
          fx += (dx / d) * k;
          fy += (dy / d) * k;
          fz += (dz / d) * k;
        }
      }
      if (!wrap) {
        if (x[i] < MARGIN) fx += (MARGIN - x[i]) * 0.012;
        if (x[i] > BX - MARGIN) fx -= (x[i] - (BX - MARGIN)) * 0.012;
        if (y[i] < MARGIN) fy += (MARGIN - y[i]) * 0.012;
        if (y[i] > BY - MARGIN) fy -= (y[i] - (BY - MARGIN)) * 0.012;
        if (z[i] < MARGIN) fz += (MARGIN - z[i]) * 0.012;
        if (z[i] > BZ - MARGIN) fz -= (z[i] - (BZ - MARGIN)) * 0.012;
      }
      fx += (this.rand() - 0.5) * 0.07;
      fy += (this.rand() - 0.5) * 0.07;
      fz += (this.rand() - 0.5) * 0.07;
      ax[i] = fx;
      ay[i] = fy;
      az[i] = fz;
    }

    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      vx[i] += ax[i];
      vy[i] += ay[i];
      vz[i] += az[i];
      const top = BASE_SPEED * (this.params.pace[group[i]] ?? 1) * this.speed[i];
      const sp = Math.hypot(vx[i], vy[i], vz[i]) || 1e-6;
      const k = sp > top ? top / sp : sp < MIN_SPEED ? MIN_SPEED / sp : 1;
      vx[i] *= k;
      vy[i] *= k;
      vz[i] *= k;
      x[i] = inX(x[i] + vx[i]);
      y[i] = inY(y[i] + vy[i]);
      z[i] = inZ(z[i] + vz[i]);
    }
  }

  /** How far a bird is from the nearest face, 0..1 over the last 70 units:
   *  a wrapping box fades birds out at one face and in at the other. */
  faceFade(i: number): number {
    if (!this.wrap) return 1;
    const m = Math.min(this.x[i], this.sx - this.x[i], this.y[i], this.sy - this.y[i], this.z[i], this.sz - this.z[i]);
    return Math.max(0, Math.min(1, m / MARGIN));
  }
}
