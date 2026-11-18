import { describe, expect, it } from "vitest";

import { defaultCostCode, defaultPayType, matchPayType } from "./payTypeMatch";

const rules = [
  { jtUserId: "ty", jobId: "bunk", costCode: "", payType: "Berger Bunkhouse - Regular Pay" },
  { jtUserId: "ty", jobId: "bunk", costCode: "01 31 10", payType: "Project Management" },
  { jtUserId: "dan", jobId: "bunk", costCode: "01 31 10", payType: "Dan PM" },
];

describe("matchPayType", () => {
  it("prefers the exact cost code, then the job-wide rule", () => {
    expect(matchPayType(rules, { jtUserId: "ty", jobId: "bunk", costCode: "01 31 10" })).toBe("Project Management");
    expect(matchPayType(rules, { jtUserId: "ty", jobId: "bunk", costCode: "06 10 00" })).toBe(
      "Berger Bunkhouse - Regular Pay",
    );
  });

  it("never borrows another employee's or another job's rule", () => {
    expect(matchPayType(rules, { jtUserId: "dan", jobId: "bunk", costCode: "06 10 00" })).toBe("");
    expect(matchPayType(rules, { jtUserId: "ty", jobId: "main", costCode: "01 31 10" })).toBe("");
    expect(matchPayType(rules, { jtUserId: "", jobId: "bunk", costCode: "" })).toBe("");
  });

  it("finds an employee's default cost code on a job, and only theirs", () => {
    const defaults = [{ jtUserId: "ty", jobId: "bunk", costCode: "01 31 10" }];
    expect(defaultCostCode(defaults, { jtUserId: "ty", jobId: "bunk" })).toBe("01 31 10");
    expect(defaultCostCode(defaults, { jtUserId: "dan", jobId: "bunk" })).toBe("");
  });
});

describe("defaultPayType", () => {
  it("files Regular Pay when the person has it or the list is unknown", () => {
    expect(defaultPayType([])).toBe("Regular Pay");
    expect(defaultPayType(["Project Management", "Regular Pay"])).toBe("Regular Pay");
  });

  it("takes a group's Regular Pay, else the person's first pay type", () => {
    expect(defaultPayType(["PM", "Berger Bunkhouse - Regular Pay"])).toBe("Berger Bunkhouse - Regular Pay");
    expect(defaultPayType(["Tile", "PM"])).toBe("Tile");
  });
});
