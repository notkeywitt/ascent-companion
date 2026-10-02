import { describe, expect, it } from "vitest";

import { matchPayType } from "./payTypeMatch";

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
});
