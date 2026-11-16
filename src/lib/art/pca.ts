/**
 * Plain PCA and k-means for "Art that Makes Itself" (/art). Pure math: no
 * imports, no I/O, so it runs on the server and in tests alike.
 *
 * PCA (principal component analysis) finds the directions along which a set of
 * rows varies the most. Each row gets a score on each direction; two scores make
 * an (x, y) point. Rows that are alike land near each other, so the set draws as
 * a cloud with clusters in it.
 */

/** Center each column on its mean and scale it to unit spread. A constant
 *  column becomes all zeros instead of dividing by zero. */
export function standardize(rows: number[][]): number[][] {
  const n = rows.length;
  if (n === 0) return [];
  const d = rows[0].length;
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  for (const r of rows) for (let j = 0; j < d; j++) sd[j] += (r[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]);
  return rows.map((r) => r.map((v, j) => (sd[j] > 1e-12 ? (v - mean[j]) / sd[j] : 0)));
}

/**
 * Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations.
 * Returns eigenvalues in descending order with their unit eigenvectors.
 * Exact enough for a 100 × 100 covariance in well under a second.
 */
export function symmetricEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const d = a.length;
  const m = a.map((r) => r.slice());
  const v = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j): number => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < d; p++) for (let q = p + 1; q < d; q++) off += m[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < d; p++) {
      for (let q = p + 1; q < d; q++) {
        if (Math.abs(m[p][q]) < 1e-15) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < d; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < d; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < d; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: d }, (_, i) => i).sort((i, j) => m[j][j] - m[i][i]);
  return {
    values: order.map((i) => m[i][i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

export interface PcaResult {
  /** rows × k scores. */
  scores: number[][];
  /** k unit vectors, each of length d (the loadings). */
  components: number[][];
  /** Share of total variance each component explains, 0..1. */
  explained: number[];
}

/** PCA of already-standardized rows, keeping the first `k` components. Each
 *  component's sign is fixed so its largest loading is positive, so a re-run on
 *  the same data never flips the picture. */
export function pca(x: number[][], k: number): PcaResult {
  const n = x.length;
  const d = n ? x[0].length : 0;
  if (n < 2 || d === 0) return { scores: x.map(() => new Array(k).fill(0)), components: [], explained: [] };
  const cov = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of x) {
    for (let i = 0; i < d; i++) {
      const ri = r[i];
      if (ri === 0) continue;
      const row = cov[i];
      for (let j = i; j < d; j++) row[j] += ri * r[j];
    }
  }
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      cov[i][j] /= n - 1;
      cov[j][i] = cov[i][j];
    }
  }
  const { values, vectors } = symmetricEigen(cov);
  const total = values.reduce((s, v) => s + Math.max(v, 0), 0) || 1;
  const kk = Math.min(k, d);
  const components = vectors.slice(0, kk).map((vec) => {
    let big = 0;
    for (const w of vec) if (Math.abs(w) > Math.abs(big)) big = w;
    return big < 0 ? vec.map((w) => -w) : vec;
  });
  const scores = x.map((r) => components.map((c) => c.reduce((s, w, j) => s + w * r[j], 0)));
  return { scores, components, explained: values.slice(0, kk).map((v) => Math.max(v, 0) / total) };
}

/** A small seeded random source, so the clusters come out the same each run. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** k-means with k-means++ seeding. Returns each row's cluster, 0..k-1. */
export function kmeans(points: number[][], k: number, seed = 7, iterations = 40): number[] {
  const n = points.length;
  if (n === 0) return [];
  const kk = Math.max(1, Math.min(k, n));
  const rand = seeded(seed);
  const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const centers: number[][] = [points[Math.floor(rand() * n)].slice()];
  while (centers.length < kk) {
    const d2 = points.map((p) => Math.min(...centers.map((c) => dist(p, c))));
    const sum = d2.reduce((s, v) => s + v, 0);
    let pick = rand() * sum;
    let idx = 0;
    while (idx < n - 1 && pick > d2[idx]) pick -= d2[idx++];
    centers.push(points[idx].slice());
  }
  const label = new Array(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < kk; c++) {
        const dd = dist(points[i], centers[c]);
        if (dd < bd) {
          bd = dd;
          best = c;
        }
      }
      if (label[i] !== best) {
        label[i] = best;
        moved = true;
      }
    }
    const dim = points[0].length;
    const sums = Array.from({ length: kk }, () => new Array(dim).fill(0));
    const counts = new Array(kk).fill(0);
    for (let i = 0; i < n; i++) {
      counts[label[i]]++;
      for (let j = 0; j < dim; j++) sums[label[i]][j] += points[i][j];
    }
    for (let c = 0; c < kk; c++) if (counts[c]) centers[c] = sums[c].map((s) => s / counts[c]);
    if (!moved && it > 0) break;
  }
  // Number clusters biggest first, so colour 1 is always the largest group.
  const sizes = new Array(kk).fill(0);
  for (const l of label) sizes[l]++;
  const rank = Array.from({ length: kk }, (_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  const remap = new Array(kk);
  rank.forEach((c, i) => (remap[c] = i));
  return label.map((l) => remap[l]);
}
