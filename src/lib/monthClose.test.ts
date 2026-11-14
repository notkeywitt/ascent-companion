import { describe, expect, it } from "vitest";

import {
  checkLaborMonth,
  closeProgress,
  laborLabel,
  planCopy,
  planSheet,
  recordsLabel,
  sheetWriteBlocked,
  sheetsCatchUp,
  shortMonth,
  type LaborMonthCheck,
} from "./monthClose";

// Seely's Labor tab as readTrackingSheet returned it on 2026-11-14.
const seely = [
  ["October '26 Labor", "Seely - Apartment Remod"],
  ["", "sum ", "min ", "max ", "cost per hour", "total"],
  ["01 31 10", "2", "10/1/2026", "10/2/2026", "$90.00", "$180.00", "", "Total Labor Time", "10"],
  ["01 31 50", "8", "10/1/2026", "10/2/2026", "$75.00", "$600.00", "", "Total Labor Cost", "$780.00"],
  ["", "", "", "", "", "", "", "min ", "max "],
];
const okLabor: LaborMonthCheck = { ok: true, label: "October '26 Labor", problems: [] };
const badLabor: LaborMonthCheck = { ok: false, label: "x", problems: ["wrong"] };

describe("labels", () => {
  it("names the record block for the invoicing month and the labor file for the billing month", () => {
    expect(recordsLabel("2026-10")).toBe("November '26");
    expect(recordsLabel("2026-12")).toBe("January '27");
    expect(laborLabel("2026-10")).toBe("October '26 Labor");
    expect(shortMonth("2027-01")).toBe("January '27");
  });
});

describe("checkLaborMonth", () => {
  it("passes Seely's October tab", () => {
    expect(checkLaborMonth(seely, "2026-10")).toEqual(okLabor);
  });
  it("fails a tab pointed at another month", () => {
    const r = checkLaborMonth(seely, "2026-11");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toBe(`Labor tab A1 points at "October '26 Labor", not "November '26 Labor".`);
    expect(r.problems[1]).toMatch(/work outside November: row 3 \(01 31 10\) 10\/1\/2026; row 4/);
  });
  it("fails an empty A1 and a missing tab", () => {
    expect(checkLaborMonth([[""]], "2026-10").problems[0]).toMatch(/A1 is empty/);
    expect(checkLaborMonth([], "2026-10").problems).toEqual(["The sheet has no Labor tab."]);
  });
  it("accepts a curly apostrophe and a month with no labor rows", () => {
    expect(checkLaborMonth([["October ’26 Labor"]], "2026-10").ok).toBe(true);
  });
});

describe("planCopy", () => {
  it("keeps a block that already holds the month", () => {
    expect(planCopy({ mode: "overwrote-existing-month-block", overwroteValues: true })).toBe("keep");
    expect(planCopy({ mode: "overwrote-existing-month-block", overwroteValues: false })).toBe("copy");
    expect(planCopy({ mode: "new-block", overwroteValues: false })).toBe("copy");
  });
});

describe("planSheet", () => {
  const fresh = { mode: "new-block", overwroteValues: false, monthLabel: "November '26", blocksRemaining: 10 };
  it("copies a clean sheet", () => {
    expect(planSheet({ shared: false, dry: fresh, labor: okLabor })).toEqual({ action: "copy", reasons: [] });
  });
  it("skips a shared sheet, a failed read and a failed dry run", () => {
    expect(planSheet({ shared: true, dry: fresh, labor: okLabor }).action).toBe("skip");
    expect(planSheet({ shared: false, readError: "no tab", dry: fresh, labor: okLabor }).reasons).toEqual(["no tab"]);
    expect(planSheet({ shared: false, finalizeError: "No reserved month block", labor: okLabor }).action).toBe("skip");
  });
  it("leaves a filed block alone even when the labor tab has moved on", () => {
    const filed = { mode: "overwrote-existing-month-block", overwroteValues: true, monthLabel: "November '26" };
    expect(planSheet({ shared: false, dry: filed, labor: badLabor }).action).toBe("filed");
  });
  it("skips a sheet whose labor is another month's", () => {
    expect(planSheet({ shared: false, dry: fresh, labor: badLabor })).toEqual({ action: "skip", reasons: ["wrong"] });
  });
  it("warns on the last free blocks", () => {
    expect(planSheet({ shared: false, dry: { ...fresh, blocksRemaining: 0 }, labor: okLabor }).reasons[0]).toMatch(
      /last free/,
    );
  });
});

describe("the month", () => {
  it("counts closed jobs", () => {
    expect(closeProgress(["a", "b", "c"], new Set(["a", "c", "z"]))).toEqual({ closed: 2, total: 3, done: false });
    expect(closeProgress(["a"], new Set(["a"])).done).toBe(true);
    expect(closeProgress([], new Set()).done).toBe(false);
  });
  it("lets a hub action write a sheet only in the sheets' month", () => {
    expect(sheetWriteBlocked("2026-10", "2026-10")).toBe("");
    expect(sheetWriteBlocked("2026-09", "2026-10")).toMatch(/September '26 is closed/);
    expect(sheetWriteBlocked("2026-11", "2026-10")).toMatch(/opens when October '26 closes/);
  });
  it("catches a stored month up to the month before Home's", () => {
    expect(sheetsCatchUp("2026-07", "2026-11")).toBe("2026-10");
    expect(sheetsCatchUp("2026-10", "2026-11")).toBeNull();
    expect(sheetsCatchUp("2026-11", "2026-11")).toBeNull();
  });
});
