import { describe, expect, it } from "vitest";
import { kmeans, pca, standardize, symmetricEigen } from "./pca";
import { buildCloud, CLOUD_SPECS, type CloudRecord } from "./cloud";

describe("symmetricEigen", () => {
  it("finds the eigenvalues of a 2 × 2 matrix, largest first", () => {
    const { values, vectors } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    expect(values[0]).toBeCloseTo(3);
    expect(values[1]).toBeCloseTo(1);
    expect(Math.abs(vectors[0][0])).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("pca", () => {
  it("puts the first component along the line the points lie on", () => {
    const rows = Array.from({ length: 50 }, (_, i) => [i, 2 * i + (i % 2 ? 0.01 : -0.01)]);
    const res = pca(standardize(rows), 2);
    expect(res.explained[0]).toBeGreaterThan(0.99);
    // Sign is fixed: the largest loading is positive.
    expect(Math.max(...res.components[0])).toBeGreaterThan(0);
  });
});

describe("kmeans", () => {
  it("separates two far-apart groups and numbers the bigger one 0", () => {
    const a = Array.from({ length: 30 }, (_, i) => [i * 0.01, 0]);
    const b = Array.from({ length: 10 }, (_, i) => [100 + i * 0.01, 0]);
    const label = kmeans([...a, ...b], 2);
    expect(new Set(label.slice(0, 30))).toEqual(new Set([0]));
    expect(new Set(label.slice(30))).toEqual(new Set([1]));
  });
});

describe("buildCloud", () => {
  it("makes one point per record, scaled to about −1..1", () => {
    const recs: CloudRecord[] = Array.from({ length: 120 }, (_, i) => ({
      title: i % 2 ? "2x4 stud" : "paint gallon",
      value: i,
      meta: "",
      num: { cost: i * 10, qty: (i % 7) + 1, unit: 10, month: 24300 + (i % 5) },
      cat: { type: i % 2 ? "Materials" : "Subcontractor", div: i % 3 ? "06" : "09", vendor: "V" },
      text: i % 2 ? "2x4 stud" : "paint gallon",
    }));
    const p = buildCloud(CLOUD_SPECS.bills, recs);
    expect(p.points).toHaveLength(120);
    expect(p.components).toHaveLength(6);
    const xs = p.points.map((pt) => Math.abs(pt[0]));
    expect(Math.max(...xs)).toBeLessThan(3);
    expect(p.clusters.reduce((s, c) => s + c.size, 0)).toBe(120);
  });
});
