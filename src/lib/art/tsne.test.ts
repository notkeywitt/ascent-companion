import { describe, expect, it } from "vitest";
import { Tsne } from "./tsne";

describe("Tsne", () => {
  it("pulls two separate groups into two separate islands", () => {
    const a = Array.from({ length: 40 }, (_, i) => [0 + (i % 5) * 0.01, 0, 0]);
    const b = Array.from({ length: 40 }, (_, i) => [10 + (i % 5) * 0.01, 10, 10]);
    const ts = new Tsne([...a, ...b], { perplexity: 10 });
    for (let i = 0; i < 300; i++) ts.step();
    const at = ts.scaled();
    const mean = (pts: { x: number; y: number }[]) => ({
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    });
    const ma = mean(at.slice(0, 40));
    const mb = mean(at.slice(40));
    const gap = Math.hypot(ma.x - mb.x, ma.y - mb.y);
    const spread = Math.max(...at.slice(0, 40).map((p) => Math.hypot(p.x - ma.x, p.y - ma.y)));
    expect(gap).toBeGreaterThan(spread);
    expect(ts.iteration).toBe(300);
  });
});
