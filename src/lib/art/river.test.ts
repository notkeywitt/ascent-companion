import { describe, expect, it } from "vitest";
import { foldTop, insideOut, stackWiggle, weekOf, weeklyByKey } from "./river";

const rows = [
  { cost: 900, date: "2026-03-04", g: "a" },
  { cost: 300, date: "2026-03-05", g: "b" },
  { cost: 1200, date: "2026-04-20", g: "a" },
  { cost: 55.5, date: "2026-06-01", g: "c" },
  { cost: 10, date: "2026-11-09", g: "c" },
];

describe("river", () => {
  it("starts weeks on Monday", () => {
    expect(weekOf("2026-03-09")).toBe(weekOf("2026-03-15"));
    expect(weekOf("2026-03-16")).toBe(weekOf("2026-03-09") + 1);
  });

  it("the 3-week spread conserves the total", () => {
    const { series, count } = weeklyByKey(rows, (r) => r.g);
    let sum = 0;
    for (const v of series.values()) {
      expect(v.length).toBe(count);
      sum += v.reduce((a, b) => a + b, 0);
    }
    expect(sum).toBeCloseTo(rows.reduce((a, r) => a + r.cost, 0), 6);
  });

  it("spreads one bill over three weeks", () => {
    const { series } = weeklyByKey([{ cost: 30, date: "2026-03-04" }], () => "x");
    expect(series.get("x")!.filter((v) => v > 0)).toEqual([10, 10, 10]);
  });

  it("folds past n groups into Other", () => {
    const { series } = weeklyByKey(rows, (r) => r.g);
    const layers = foldTop(series, 2);
    expect(layers.map((l) => l.key)).toEqual(["a", "b", "Other"]);
    expect(layers.reduce((a, l) => a + l.total, 0)).toBeCloseTo(2465.5, 6);
  });

  it("stacked thickness per week equals the week total", () => {
    const { series } = weeklyByKey(rows, (r) => r.g);
    const layers = insideOut(foldTop(series, 7));
    const vals = layers.map((l) => l.values);
    const { lower, upper } = stackWiggle(vals);
    for (let j = 0; j < vals[0].length; j++) {
      const total = vals.reduce((a, v) => a + v[j], 0);
      const thick = upper[upper.length - 1][j] - lower[0][j];
      expect(thick).toBeCloseTo(total, 6);
      for (let i = 1; i < vals.length; i++) expect(lower[i][j]).toBeCloseTo(upper[i - 1][j], 6);
    }
  });

  it("puts the biggest layer in the middle", () => {
    expect(insideOut([5, 4, 3, 2, 1])).toEqual([2, 4, 5, 3, 1]);
  });
});
