import { describe, expect, it } from "vitest";
import {
  buildHeadroom,
  isCommitted,
  jobRingRows,
  monthRingRows,
  remainingOf,
  usedOf,
  type DivisionIn,
  type LeafIn,
  type LineIn,
  type TimeIn,
} from "./headroom";

// A job with two coded divisions and one code that only has a budget leaf.
const divisions: DivisionIn[] = [
  {
    name: "Finishes",
    codes: [
      { number: "09 64 00", name: "Wood Flooring", budget: 10_000, bills: 4_000, labor: 1_000 },
      { number: "09 30 00", name: "Tile", budget: 5_000, bills: 0, labor: 0 },
    ],
  },
];
const leavesByCode = new Map<string, LeafIn[]>([
  ["09 64 00", [{ name: "Wood Flooring", cost: 10_000 }]],
  ["12 36 00", [{ name: "Countertops", cost: 7_000, division: "Furnishings" }, { name: "Backsplash", cost: 500 }]],
]);

type Line = LineIn & { id: string };
type Time = TimeIn & { id: string };
const line = (id: string, code: string, cost: number, billStatus: string): Line => ({
  id,
  code,
  codeName: `name ${code}`,
  cost,
  billStatus,
});
const time = (id: string, code: string, cost: number): Time => ({ id, code, codeName: `name ${code}`, cost });

/** Build with a staged map: id → the code it has been moved to. */
function build(lines: Line[], times: Time[], staged: Record<string, string> = {}) {
  return buildHeadroom({
    divisions,
    leavesByCode,
    lines,
    timeEntries: times,
    codeOf: (l) => staged[l.id] ?? l.code,
    timeCodeOf: (t) => staged[t.id] ?? t.code,
  });
}

describe("buildHeadroom", () => {
  it("starts from the cost detail, and gives a budget-only code its own row", () => {
    const h = build([], []);
    expect(h.get("09 64 00")).toMatchObject({ budget: 10_000, spent: 4_000, labor: 1_000, drafts: 0, droppable: true });
    // No budget leaf, so nothing can be dropped on it.
    expect(h.get("09 30 00")?.droppable).toBe(false);
    expect(h.get("12 36 00")).toMatchObject({
      name: "Countertops",
      division: "Furnishings",
      budget: 7_500,
      spent: 0,
      droppable: true,
    });
  });

  it("leaves a committed line where the cost detail already counts it", () => {
    const h = build([line("a", "09 64 00", 800, "approved")], []);
    expect(h.get("09 64 00")?.spent).toBe(4_000);
  });

  it("moves a staged committed line off its old code and onto the new one", () => {
    const h = build([line("a", "09 64 00", 800, "pending")], [], { a: "09 30 00" });
    expect(h.get("09 64 00")?.spent).toBe(3_200);
    expect(h.get("09 30 00")?.spent).toBe(800);
  });

  it("adds a draft line whole under the code it sits on now", () => {
    const h = build([line("a", "09 64 00", 250, "draft"), line("b", "", 99, "draft")], [], { a: "12 36 00" });
    expect(h.get("12 36 00")?.drafts).toBe(250);
    expect(h.get("09 64 00")?.drafts).toBe(0);
    // An uncoded draft counts nowhere.
    expect([...h.values()].reduce((s, r) => s + r.drafts, 0)).toBe(250);
  });

  it("creates a row for a code the budget never had, named by its division", () => {
    const h = build([line("a", "09 64 00", 100, "approved")], [], { a: "09 99 99" });
    expect(h.get("09 99 99")).toMatchObject({ budget: 0, spent: 100, division: "", droppable: false });
  });

  it("transfers staged labor the same way", () => {
    const h = build([], [time("t", "09 64 00", 300)], { t: "09 30 00" });
    expect(h.get("09 64 00")?.labor).toBe(700);
    expect(h.get("09 30 00")?.labor).toBe(300);
  });

  it("counts drafts and labor in what is used", () => {
    const h = build([line("a", "09 64 00", 500, "draft")], []);
    const floor = h.get("09 64 00")!;
    expect(usedOf(floor)).toBe(4_000 + 500 + 1_000);
    expect(remainingOf(floor)).toBe(4_500);
  });
});

describe("the cost rings", () => {
  it("fold drafts into bills and drop codes with no cost", () => {
    const h = build([line("a", "09 64 00", 500, "draft")], []);
    const rows = jobRingRows(h);
    expect(rows.find((r) => r.code === "09 64 00")).toEqual({ code: "09 64 00", name: "Wood Flooring", bills: 4_500, labor: 1_000 });
    expect(rows.some((r) => r.code === "09 30 00")).toBe(false);
  });

  it("build the month from its own lines and hours, named off the rail first", () => {
    const lines = [line("a", "09 64 00", 200, "approved"), line("b", "99 00 00", 50, "draft")];
    const times = [time("t", "09 64 00", 75)];
    const h = build(lines, times);
    const rows = monthRingRows({ lines, timeEntries: times, codeOf: (l) => l.code, timeCodeOf: (t) => t.code, headroom: h });
    expect(rows).toEqual([
      { code: "09 64 00", name: "Wood Flooring", bills: 200, labor: 75 },
      { code: "99 00 00", name: "name 99 00 00", bills: 50, labor: 0 },
    ]);
  });
});

describe("a credit in the rings", () => {
  it("keeps a code a credit drove negative, so the centre can net it", () => {
    const lines = [line("a", "09 64 00", 200, "approved"), line("b", "06 20 00", -300, "draft")];
    const h = build(lines, []);
    const rows = monthRingRows({ lines, timeEntries: [] as ReturnType<typeof time>[], codeOf: (l) => l.code, timeCodeOf: (t) => t.code, headroom: h });
    expect(rows.reduce((n, r) => n + r.bills, 0)).toBe(-100);
  });
});

describe("isCommitted", () => {
  it("is pending or approved, never draft or denied", () => {
    expect(["pending", "approved", "draft", "denied"].map(isCommitted)).toEqual([true, true, false, false]);
  });
});
