import { describe, expect, it } from "vitest";
import { rankCandidates, sunsetLineKey, sunsetLinkId, type SunsetCandidate } from "./sunsetLinks";

const c = (uid: string, amount: number, extra: Partial<SunsetCandidate> = {}): SunsetCandidate => ({
  uid, number: uid, amount, isCredit: amount < 0, date: "2026-10-05", docId: uid, jobId: "j",
  jobName: "Berger", claimedBy: null, ...extra,
});

describe("sunsetLineKey — must match appscript _sunreconNormNum", () => {
  it("drops formatting and leading zeros, never digits", () => {
    expect(sunsetLineKey("#0700100")).toBe("700100");
    expect(sunsetLineKey(" 70-01 00 ")).toBe("700100");
    expect(sunsetLineKey("000")).toBe("0");
    expect(sunsetLineKey("ab12")).toBe("AB12");
  });
  it("keys a link by statement and line", () => {
    expect(sunsetLinkId(" STMT-1 ", "#012")).toBe("STMT-1|12");
  });
});

describe("rankCandidates — the Link picker's order", () => {
  it("puts unclaimed bills first, then the closest amount, then the same date", () => {
    const list = [
      c("claimed", 50, { claimedBy: { statementId: "S", line: "1" } }),
      c("far", 90),
      c("near-other-day", 50, { date: "2026-10-09" }),
      c("near", 50),
    ];
    expect(rankCandidates(list, { amount: 50, date: "2026-10-05" }).map((x) => x.uid)).toEqual([
      "near", "near-other-day", "far", "claimed",
    ]);
  });
  it("filters by number, job or amount", () => {
    const list = [c("700100", 55.5, { jobName: "Miller" }), c("700200", 12)];
    expect(rankCandidates(list, { amount: 0 }, "mill").map((x) => x.uid)).toEqual(["700100"]);
    expect(rankCandidates(list, { amount: 0 }, "7002").map((x) => x.uid)).toEqual(["700200"]);
    expect(rankCandidates(list, { amount: 0 }, "$55.50").map((x) => x.uid)).toEqual(["700100"]);
  });
});
