import { describe, expect, it } from "vitest";
import { Flock, flockSetup, MAX_GROUPS, OTHER, type FlockItem } from "./flock";

const spread = (f: Flock, g: number) => {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < f.n; i++) if (f.group[i] === g) (sx += f.x[i]), (sy += f.y[i]), n++;
  const mx = sx / n;
  const my = sy / n;
  let d = 0;
  for (let i = 0; i < f.n; i++) if (f.group[i] === g) d += Math.hypot(f.x[i] - mx, f.y[i] - my);
  return d / n;
};

describe("Flock", () => {
  it("gathers a scattered group into a tighter flock and keeps every bird on screen", () => {
    const birds = Array.from({ length: 120 }, (_, i) => ({ group: i % 2, size: 0.5 }));
    const f = new Flock(birds, { pace: [1, 1], affinity: [[0, 0], [0, 0]] }, 600, 400);
    const before = spread(f, 0);
    for (let s = 0; s < 600; s++) f.step();
    expect(spread(f, 0)).toBeLessThan(before);
    for (let i = 0; i < f.n; i++) {
      expect(f.x[i]).toBeGreaterThanOrEqual(0);
      expect(f.x[i]).toBeLessThanOrEqual(600);
      expect(f.y[i]).toBeGreaterThanOrEqual(0);
      expect(f.y[i]).toBeLessThanOrEqual(400);
    }
  });

  it("never lets a bird fly faster than its group's pace allows", () => {
    const f = new Flock([{ group: 0, size: 1 }, { group: 1, size: 1 }], { pace: [0.6, 1.6], affinity: [] }, 300, 300);
    for (let s = 0; s < 50; s++) f.step({ x: 150, y: 150 });
    expect(Math.hypot(f.vx[0], f.vy[0])).toBeLessThanOrEqual(1.6 * 0.6 + 1e-4);
    expect(Math.hypot(f.vx[1], f.vy[1])).toBeLessThanOrEqual(1.6 * 1.6 + 1e-4);
  });
});

describe("flockSetup", () => {
  it("folds groups past the limit into Other, biggest first", () => {
    const items: FlockItem[] = Array.from({ length: 20 }, (_, i) => ({
      key: `job ${i}`,
      link: "v",
      value: 100 - i,
      date: "",
    }));
    const s = flockSetup(items);
    expect(s.names).toHaveLength(MAX_GROUPS);
    expect(s.names[0]).toBe("job 0");
    expect(s.names[MAX_GROUPS - 1]).toBe(OTHER);
    expect(s.params.pace.every((p) => p === 1)).toBe(true);
  });

  it("links two groups that share a vendor, and gives a busy group more pace", () => {
    const s = flockSetup([
      { key: "A", link: "v1", value: 10, date: "2026-11-01" },
      { key: "B", link: "v1", value: 10, date: "2026-01-01" },
      { key: "C", link: "v2", value: 10, date: "2026-01-01" },
    ]);
    const [a, b, c] = ["A", "B", "C"].map((k) => s.names.indexOf(k));
    expect(s.params.affinity[a][b]).toBe(1);
    expect(s.params.affinity[a][c]).toBe(0);
    expect(s.params.pace[a]).toBeGreaterThan(s.params.pace[b]);
  });
});
