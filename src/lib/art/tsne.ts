/**
 * A small t-SNE that runs one step at a time, for the Cost Cloud's "Islands"
 * layout (/art/cloud). t-SNE pulls rows that are alike into tight islands; the
 * page calls `step()` a few times per frame, so the viewer watches the dots
 * sort themselves.
 *
 * Exact repulsion (every pair, O(n²) per step) and sparse attraction (each
 * row's nearest neighbours only). Fine for the few thousand rows a data set
 * holds. Pure: no DOM, no imports.
 */
import { seeded } from "./pca";

export interface TsneOptions {
  perplexity?: number;
  learningRate?: number;
  seed?: number;
}

export class Tsne {
  readonly n: number;
  /** Current 2-D positions, x then y for each row. */
  readonly y: Float64Array;
  private readonly gains: Float64Array;
  private readonly vel: Float64Array;
  private readonly nbr: Int32Array[];
  private readonly pij: Float64Array[];
  private readonly lr: number;
  iteration = 0;

  constructor(data: number[][], opts: TsneOptions = {}) {
    const n = data.length;
    this.n = n;
    this.lr = opts.learningRate ?? Math.max(50, n / 12);
    const perp = Math.min(opts.perplexity ?? 30, Math.max(2, (n - 1) / 3));
    const k = Math.min(n - 1, Math.floor(perp * 3));
    const rand = seeded(opts.seed ?? 5);

    // Nearest neighbours by brute force, then a binary search per row for the
    // Gaussian width that gives the asked-for perplexity.
    const nbr: Int32Array[] = [];
    const cond: Float64Array[] = [];
    const d2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        const a = data[i];
        const b = data[j];
        for (let c = 0; c < a.length; c++) s += (a[c] - b[c]) ** 2;
        d2[j] = i === j ? Infinity : s;
      }
      const order = Array.from({ length: n }, (_, j) => j)
        .sort((a, b) => d2[a] - d2[b])
        .slice(0, k);
      const dist = order.map((j) => d2[j]);
      let lo = 0;
      let hi = Infinity;
      let beta = 1;
      const target = Math.log(perp);
      let p = new Float64Array(k);
      for (let it = 0; it < 50; it++) {
        let sum = 0;
        for (let m = 0; m < k; m++) sum += p[m] = Math.exp(-dist[m] * beta);
        if (sum === 0) sum = 1e-12;
        let h = 0;
        for (let m = 0; m < k; m++) {
          p[m] /= sum;
          if (p[m] > 1e-12) h -= p[m] * Math.log(p[m]);
        }
        if (Math.abs(h - target) < 1e-4) break;
        if (h > target) {
          lo = beta;
          beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
        } else {
          hi = beta;
          beta = (beta + lo) / 2;
        }
      }
      nbr.push(Int32Array.from(order));
      cond.push(p);
      p = new Float64Array(0);
    }

    // Symmetrise: p_ij = (p_j|i + p_i|j) / 2n, kept on i's neighbour list.
    const lookup = nbr.map((list, i) => {
      const m = new Map<number, number>();
      list.forEach((j, idx) => m.set(j, cond[i][idx]));
      return m;
    });
    this.nbr = nbr;
    this.pij = nbr.map((list, i) =>
      Float64Array.from(list, (j, idx) => (cond[i][idx] + (lookup[j].get(i) ?? 0)) / (2 * n)),
    );

    this.y = new Float64Array(2 * n);
    for (let i = 0; i < 2 * n; i++) this.y[i] = (rand() - 0.5) * 1e-2;
    this.gains = new Float64Array(2 * n).fill(1);
    this.vel = new Float64Array(2 * n);
  }

  /** One gradient step. Early exaggeration for the first 100 steps. */
  step(): void {
    const { n, y } = this;
    const exag = this.iteration < 100 ? 12 : 1;
    const mom = this.iteration < 250 ? 0.5 : 0.8;
    const grad = new Float64Array(2 * n);

    // Repulsion over every pair, with the normaliser Z.
    let z = 0;
    for (let i = 0; i < n; i++) {
      const xi = y[2 * i];
      const yi = y[2 * i + 1];
      for (let j = i + 1; j < n; j++) {
        const dx = xi - y[2 * j];
        const dy = yi - y[2 * j + 1];
        const q = 1 / (1 + dx * dx + dy * dy);
        z += 2 * q;
        const q2 = q * q;
        grad[2 * i] -= q2 * dx;
        grad[2 * i + 1] -= q2 * dy;
        grad[2 * j] += q2 * dx;
        grad[2 * j + 1] += q2 * dy;
      }
    }
    const inv = 1 / (z || 1);
    for (let i = 0; i < 2 * n; i++) grad[i] *= inv;

    // Attraction along the neighbour lists.
    for (let i = 0; i < n; i++) {
      const list = this.nbr[i];
      const p = this.pij[i];
      for (let m = 0; m < list.length; m++) {
        const j = list[m];
        const dx = y[2 * i] - y[2 * j];
        const dy = y[2 * i + 1] - y[2 * j + 1];
        const f = exag * p[m] / (1 + dx * dx + dy * dy);
        grad[2 * i] += f * dx;
        grad[2 * i + 1] += f * dy;
        grad[2 * j] -= f * dx;
        grad[2 * j + 1] -= f * dy;
      }
    }

    for (let i = 0; i < 2 * n; i++) {
      const g = 4 * grad[i];
      this.gains[i] = Math.sign(g) === Math.sign(this.vel[i]) ? this.gains[i] * 0.8 : this.gains[i] + 0.2;
      if (this.gains[i] < 0.01) this.gains[i] = 0.01;
      this.vel[i] = mom * this.vel[i] - this.lr * this.gains[i] * g;
      y[i] += this.vel[i];
    }
    this.iteration++;
  }

  /** Positions scaled so the 98th percentile sits at ±1, centred. */
  scaled(): { x: number; y: number }[] {
    const { n, y } = this;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += y[2 * i] / n;
      my += y[2 * i + 1] / n;
    }
    const r = Array.from({ length: n }, (_, i) => Math.max(Math.abs(y[2 * i] - mx), Math.abs(y[2 * i + 1] - my))).sort(
      (a, b) => a - b,
    );
    const s = r[Math.min(n - 1, Math.floor(n * 0.98))] || 1;
    return Array.from({ length: n }, (_, i) => ({ x: (y[2 * i] - mx) / s, y: (y[2 * i + 1] - my) / s }));
  }
}
