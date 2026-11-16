import { describe, expect, it } from "vitest";
import { aggregateJobs, axisDivisions, divisionShares, glyphValues } from "./fingerprints";

const rows = [
  { cost: 100, price: 130, code: "06 10 00", job: "Oak St" },
  { cost: 300, price: 360, code: "09 20 00", job: "Oak St" },
  { cost: 50, price: 60, code: "26 00 00", job: "Oak St" },
  { cost: 40, price: 50, code: "06 20 00", job: "Elm Ct" },
  { cost: 10, price: 20, code: "09 30 00", job: "Elm Ct" },
  { cost: 5, price: 0, code: "", job: "" },
];

describe("fingerprints", () => {
  it("shares per job sum to 1", () => {
    for (const j of aggregateJobs(rows)) {
      for (const field of ["cost", "price"] as const) {
        const sum = [...divisionShares(j, field).values()].reduce((a, b) => a + b, 0);
        if (j[field] > 0) expect(sum).toBeCloseTo(1, 9);
      }
    }
  });

  it("orders jobs by cost and axes by spend", () => {
    expect(aggregateJobs(rows).map((j) => j.job)).toEqual(["Oak St", "Elm Ct", "No job"]);
    expect(axisDivisions(rows, 2)).toEqual(["09", "06"]);
  });

  it("clamps margin to 0..1", () => {
    const oak = aggregateJobs(rows)[0];
    const v = glyphValues(oak, ["06", "09", "99"], "margin");
    expect(v[0]).toBeCloseTo(30 / 130, 9);
    expect(v[2]).toBe(0);
    for (const x of v) expect(x >= 0 && x <= 1).toBe(true);
  });
});
