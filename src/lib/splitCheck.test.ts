import { describe, expect, it } from "vitest";
import { checkSplit, splitFamily, type SplitLink } from "./splitCheck";

const links: SplitLink[] = [
  { newDocId: "B", originalDocId: "A", originalTotal: 300.1, originalLineCount: 5, createdAt: "2026-11-01" },
  { newDocId: "C", originalDocId: "A", originalTotal: 200, originalLineCount: 3, createdAt: "2026-11-02" },
  { newDocId: "D", originalDocId: "B", originalTotal: 100.1, originalLineCount: 2, createdAt: "2026-11-03" },
];

describe("splitFamily", () => {
  it("finds the root and every piece from any member", () => {
    for (const id of ["A", "B", "C", "D"]) {
      expect(splitFamily(links, id)).toEqual({
        rootId: "A",
        pieceIds: ["A", "B", "C", "D"],
        originalTotal: 300.1,
        originalLineCount: 5,
      });
    }
  });
  it("is null for a bill never split", () => {
    expect(splitFamily(links, "Z")).toBeNull();
  });
});

describe("checkSplit", () => {
  const fam = { originalTotal: 300.1, originalLineCount: 5 };
  it("matches to the cent despite float sums", () => {
    const r = checkSplit(fam, [
      { total: 100.03, lineCount: 2 },
      { total: 100.03, lineCount: 1 },
      { total: 100.04, lineCount: 2 },
    ]);
    expect(r).toEqual({ total: 300.1, lineCount: 5, totalDiff: 0, lineDiff: 0, matches: true });
  });
  it("reports the difference after a piece is edited", () => {
    const r = checkSplit(fam, [
      { total: 200, lineCount: 3 },
      { total: 75.1, lineCount: 1 },
    ]);
    expect(r.matches).toBe(false);
    expect(r.totalDiff).toBe(-25);
    expect(r.lineDiff).toBe(-1);
  });
});
