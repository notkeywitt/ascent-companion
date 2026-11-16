import { describe, expect, it } from "vitest";
import { fontSize, layoutWords, tokenize, wordStats } from "./words";

const measure = (word: string, size: number) => ({ w: word.length * size * 0.55, h: size * 1.1 });

describe("words", () => {
  it("tokenises, drops stop words, short words and numbers", () => {
    expect(tokenize("The 2x4 Stud and 12345 SKU Framing, framing for 8ft")).toEqual(["stud", "framing"]);
  });

  it("weighs by dollars and by count", () => {
    const rows = [
      { name: "Oak flooring", cost: 500, code: "09 64 00" },
      { name: "Oak trim", cost: 100, code: "06 20 00" },
      { name: "Paint", cost: 50, code: "09 91 00" },
      { name: "Paint", cost: 50, code: "09 91 00" },
      { name: "Paint", cost: 50, code: "09 91 00" },
    ];
    const d = wordStats(rows, "dollars");
    expect(d[0]).toMatchObject({ word: "oak", dollars: 600, count: 2, division: "09" });
    const c = wordStats(rows, "count");
    expect(c[0]).toMatchObject({ word: "paint", count: 3 });
  });

  it("sizes on a sqrt scale between 11 and 64", () => {
    expect(fontSize(100, 100)).toBe(64);
    expect(fontSize(0, 100)).toBe(11);
    expect(fontSize(25, 100)).toBeCloseTo(11 + 53 * 0.5, 9);
  });

  it("places no overlapping boxes and keeps the biggest nearest the centre", () => {
    const words = Array.from({ length: 80 }, (_, i) => ({ word: `word${i}`, size: Math.max(11, 60 - i) }));
    const out = layoutWords(words, 900, 560, measure);
    expect(out.length).toBeGreaterThan(20);
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      expect(a.x - a.w / 2).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w / 2).toBeLessThanOrEqual(900);
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j];
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart).toBe(true);
      }
    }
    const dist = (p: (typeof out)[number]) => Math.hypot(p.x - 450, p.y - 280);
    expect(dist(out[0])).toBe(Math.min(...out.map(dist)));
  });

  it("skips a word that does not fit", () => {
    expect(layoutWords([{ word: "enormous", size: 500 }], 300, 200, measure)).toEqual([]);
  });
});
