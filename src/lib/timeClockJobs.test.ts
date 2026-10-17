import { describe, expect, it } from "vitest";
import { timeClockJobs } from "./timeClockJobs";

const jobs = [
  { id: "a", phase: "Active" },
  { id: "b", phase: "PreCon" },
  { id: "c", phase: "Ascent" },
  { id: "d", phase: "PreCon Budget" },
  { id: "e", phase: "Complete" },
  { id: "f", phase: "Prospective" },
  { id: "g", phase: null },
];

describe("timeClockJobs", () => {
  it("keeps Active, PreCon and Ascent jobs only", () => {
    expect(timeClockJobs(jobs, null).map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps only the jobs the employee is added to", () => {
    expect(timeClockJobs(jobs, new Set(["a", "c", "d"])).map((j) => j.id)).toEqual(["a", "c"]);
  });

  it("lists nothing for an employee added to no job", () => {
    expect(timeClockJobs(jobs, new Set())).toEqual([]);
  });
});
