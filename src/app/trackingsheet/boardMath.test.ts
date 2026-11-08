import { describe, expect, it } from "vitest";
import {
  allTimeRingRowsOf,
  approvalTaxOn,
  billCodeAmounts,
  billsCostTotal,
  billTaxOf,
  hoursLabel,
  isDivisionLevelCode,
  isTaxDirty,
  jobToDateTotal,
  laneRowsOf,
  railGroupsOf,
  railRowsOf,
  remainingForCode,
  splitLinesByDoc,
  taxViewOf,
  tightestCodesOf,
  timeHeadroomOf,
  toBeInvoiced,
} from "./boardMath";
import type { Headroom } from "./headroom";
import type { BillRef, JobBillLine } from "./Board";

/**
 * The Tracking Sheets board's own money math, pinned before the board is split
 * further (SIMPLICITY_AUDIT.md finding 01, Option B). These functions were
 * moved out of Board.tsx verbatim, so every expectation below is what the
 * board showed on the day of the move — including the cases marked
 * "NOTE: possible bug", which are pinned, not fixed.
 */

const ln = (over: Partial<JobBillLine> & { id: string; docId: string; cost: number }): JobBillLine => ({
  billStatus: "draft",
  name: "Material",
  code: "06 10 00",
  codeName: "Rough Carpentry",
  jobCostItemId: "leaf-0610",
  ...over,
});

const bill = (over: Partial<BillRef> & { id: string; cost: number }): BillRef =>
  ({
    label: over.id,
    externalId: null,
    number: null,
    vendor: "Vendor",
    status: "draft",
    issueDate: null,
    dueDate: null,
    dueDays: null,
    createdAt: null,
    name: "Bill",
    nonRecoverableTax: 0,
    recordsTax: false,
    qboIsIgnored: false,
    qboDocumentType: null,
    amountPaid: 0,
    balance: 0,
    saved: false,
    reviewed: false,
    needsReview: false,
    invoiced: false,
    onInvoice: false,
    monthInvoiceExists: false,
    fileCount: 1,
    ...over,
  }) as BillRef;

const hr = (over: Partial<Headroom> & { code: string }): Headroom => ({
  name: `name ${over.code}`,
  division: "",
  budget: 0,
  spent: 0,
  drafts: 0,
  labor: 0,
  droppable: true,
  ...over,
});
const hmap = (...rows: Headroom[]) => new Map(rows.map((h) => [h.code, h]));

describe("splitLinesByDoc — the sales-tax line comes out of the codeable lines", () => {
  const lines = [
    ln({ id: "a1", docId: "A", cost: 1_249.5 }),
    ln({ id: "a2", docId: "A", cost: -75.25, name: "Return credit" }),
    ln({ id: "a3", docId: "A", cost: 0, name: "Delivery (waived)" }),
    ln({ id: "aT", docId: "A", cost: 102.98, name: "Sales Tax", code: "88 80 00", codeName: "Sales Tax" }),
    ln({ id: "b1", docId: "B", cost: 312.4 }),
    // An uncoded line named "Sales Tax" is still the tax line.
    ln({ id: "bT", docId: "B", cost: 27.81, name: "Sales Tax", code: "" }),
    // A second tax line on the same bill adds to the first, rounded to cents.
    ln({ id: "bT2", docId: "B", cost: 0.004, name: "Sales Tax (paid)", code: "" }),
  ];

  it("keeps every non-tax line, credits and zero lines included, in order", () => {
    const { linesByDoc } = splitLinesByDoc(lines);
    expect(linesByDoc.get("A")?.map((l) => l.id)).toEqual(["a1", "a2", "a3"]);
    expect(linesByDoc.get("B")?.map((l) => l.id)).toEqual(["b1"]);
  });

  it("sums each bill's tax lines, rounding to cents after each one", () => {
    const { taxByDoc } = splitLinesByDoc(lines);
    expect(taxByDoc.get("A")).toBe(102.98);
    expect(taxByDoc.get("B")).toBe(27.81);
  });

  it("a line coded elsewhere is NOT tax, even when it is named Sales Tax", () => {
    const { linesByDoc, taxByDoc } = splitLinesByDoc([
      ln({ id: "x", docId: "C", cost: 18.4, name: "Sales Tax", code: "01 50 00" }),
    ]);
    expect(linesByDoc.get("C")?.map((l) => l.id)).toEqual(["x"]);
    expect(taxByDoc.has("C")).toBe(false);
  });

  it("reads the line's JobTread code, so a staged move onto 88 80 00 is not tax until saved", () => {
    // `code` is what JobTread holds; the staged code lives in Board's `staged`.
    const { taxByDoc } = splitLinesByDoc([ln({ id: "x", docId: "D", cost: 40 })]);
    expect(taxByDoc.size).toBe(0);
  });

  it("a non-numeric tax cost counts as zero", () => {
    const { taxByDoc } = splitLinesByDoc([
      ln({ id: "t", docId: "E", cost: Number.NaN, code: "88 80 00" }),
    ]);
    expect(taxByDoc.get("E")).toBe(0);
  });
});

describe("billTaxOf — a bill's sales tax: its 88 80 00 line plus the legacy field", () => {
  const taxByDoc = new Map([
    ["A", 102.98],
    ["C", -14.62], // a vendor credit memo refunds tax
  ]);

  it("is the tax line alone on a current-model bill", () => {
    expect(billTaxOf(taxByDoc, { id: "A", nonRecoverableTax: 0 })).toBe(102.98);
  });

  it("is the legacy field alone on an un-migrated bill", () => {
    expect(billTaxOf(taxByDoc, { id: "Z", nonRecoverableTax: 4.59 })).toBe(4.59);
  });

  it("adds both, half-migrated, rounded to cents", () => {
    expect(billTaxOf(taxByDoc, { id: "A", nonRecoverableTax: 0.1 })).toBe(103.08);
  });

  it("is negative on a credit memo", () => {
    expect(billTaxOf(taxByDoc, { id: "C" })).toBe(-14.62);
  });

  it("is 0 with no bill", () => {
    expect(billTaxOf(taxByDoc, null)).toBe(0);
    expect(billTaxOf(taxByDoc, undefined)).toBe(0);
  });
});

describe("isTaxDirty — does a staged tax figure differ from the bill's tax?", () => {
  const bills = [
    { id: "A", nonRecoverableTax: 0 },
    { id: "B", nonRecoverableTax: 0 },
  ];
  const tax = (b: { id: string } | null | undefined) => (b?.id === "A" ? 102.98 : 0);

  it("is clean when the staged figure equals the stored tax to the cent", () => {
    expect(isTaxDirty({ A: "102.98" }, bills, tax)).toBe(false);
    expect(isTaxDirty({ A: "102.981" }, bills, tax)).toBe(false);
  });

  it("is dirty when the figure moves by a cent", () => {
    expect(isTaxDirty({ A: "102.97" }, bills, tax)).toBe(true);
  });

  it("ignores an empty field and a bill that is not on the board", () => {
    expect(isTaxDirty({ A: "" }, bills, tax)).toBe(false);
    expect(isTaxDirty({ GONE: "50" }, bills, tax)).toBe(false);
    expect(isTaxDirty({ A: "5" }, undefined, tax)).toBe(false);
  });

  it("treats text that is not a number as $0", () => {
    expect(isTaxDirty({ B: "abc" }, bills, tax)).toBe(false);
    expect(isTaxDirty({ A: "abc" }, bills, tax)).toBe(true);
  });

  it("is dirty when any one of several bills moved", () => {
    expect(isTaxDirty({ A: "102.98", B: "3.10" }, bills, tax)).toBe(true);
  });
});

describe("taxViewOf — the open bill's previewed tax", () => {
  it("shows the stored tax until something is typed", () => {
    expect(taxViewOf(undefined, 102.98)).toBe(102.98);
    expect(taxViewOf("", 102.98)).toBe(102.98);
  });

  it("shows the typed figure, unrounded", () => {
    expect(taxViewOf("88.125", 102.98)).toBe(88.125);
    expect(taxViewOf("0", 102.98)).toBe(0);
    expect(taxViewOf("-14.62", 0)).toBe(-14.62);
  });

  it("shows $0 for text that is not a number", () => {
    expect(taxViewOf("abc", 102.98)).toBe(0);
  });
});

describe("approvalTaxOn — the approve dialog's Sales Tax column", () => {
  it("is on for a positive tax and off for none", () => {
    expect(approvalTaxOn(102.98)).toBe(true);
    expect(approvalTaxOn(0.01)).toBe(true);
    expect(approvalTaxOn(0)).toBe(false);
  });

  it("is OFF for a credit memo's negative tax", () => {
    // NOTE: possible bug — a credit memo that refunds $14.62 of sales tax reads
    // "Sales Tax: Off" in the approve dialog, as if it carried none.
    expect(approvalTaxOn(-14.62)).toBe(false);
  });
});

describe("toBeInvoiced — the month's headline figure", () => {
  it("is approved-and-uninvoiced plus the drafts still coding", () => {
    expect(toBeInvoiced({ remaining: 48_210.37, draftBillsCost: 3_118.9 })).toBeCloseTo(51_329.27, 2);
  });

  it("nets a credit draft", () => {
    expect(toBeInvoiced({ remaining: 1_000, draftBillsCost: -250.5 })).toBe(749.5);
  });
});

describe("billsCostTotal — the Sunset, main-list and approve-dialog totals", () => {
  it("sums each bill's cost, credits included", () => {
    expect(billsCostTotal([{ cost: 1_249.5 }, { cost: -75.25 }, { cost: 0 }, { cost: 312.4 }])).toBeCloseTo(
      1_486.65,
      2,
    );
    expect(billsCostTotal([])).toBe(0);
  });

  it("does not round — many cent amounts leave float residue for money() to hide", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in a double. money() rounds it for
    // display; nothing compares this sum to another figure.
    expect(billsCostTotal([{ cost: 0.1 }, { cost: 0.2 }])).toBe(0.30000000000000004);
    const forty = Array.from({ length: 40 }, () => ({ cost: 19.99 }));
    expect(billsCostTotal(forty)).not.toBe(799.6);
    expect(billsCostTotal(forty)).toBeCloseTo(799.6, 8);
  });
});

describe("railRowsOf — which codes the budget rail lists", () => {
  const headroom = hmap(
    hr({ code: "09 64 00", name: "Wood Flooring", budget: 10_000, spent: 4_000 }),
    hr({ code: "01 31 20", name: "Supervision", labor: 976 }), // labor only, no budget
    hr({ code: "06 10 00", name: "Rough Carpentry", drafts: -120 }), // a credit draft only
    hr({ code: "12 36 00", name: "Countertops" }), // nothing at all
  );

  it("keeps any code with a non-zero figure, in code order", () => {
    expect(railRowsOf(headroom, "").map((h) => h.code)).toEqual(["01 31 20", "06 10 00", "09 64 00"]);
  });

  it("narrows by number or name, ignoring case and spaces at the ends", () => {
    expect(railRowsOf(headroom, "  FLOOR ").map((h) => h.code)).toEqual(["09 64 00"]);
    expect(railRowsOf(headroom, "01 31").map((h) => h.code)).toEqual(["01 31 20"]);
    expect(railRowsOf(headroom, "countertops")).toEqual([]);
  });
});

describe("railGroupsOf — the rail's divisions and their summed figures", () => {
  const rows = [
    hr({ code: "09 30 00", name: "Tile", division: "Finishes", budget: 5_000, spent: 5_400, labor: 300 }),
    hr({ code: "09 64 00", name: "Wood Flooring", division: "Finishes", budget: 10_000, spent: 4_000, drafts: 500, labor: 1_000 }),
    hr({ code: "04 00 00", name: "Masonry", budget: 2_500, spent: 1_200.5 }),
    hr({ code: "04 20 00", name: "Unit Masonry", budget: 0, spent: 310.75 }),
    hr({ code: "", name: "", drafts: 89.99 }),
  ];

  it("sums budget, used and remaining per division", () => {
    const g = railGroupsOf(rows);
    const fin = g.find((x) => x.code === "09")!;
    expect(fin.name).toBe("Finishes");
    expect(fin.budget).toBe(15_000);
    expect(fin.used).toBe(5_400 + 300 + 4_000 + 500 + 1_000);
    expect(fin.remaining).toBe(15_000 - 11_200);
  });

  it("names a division by its division-level code when JobTread gives no parent", () => {
    const g = railGroupsOf(rows);
    const mas = g.find((x) => x.code === "04")!;
    expect(mas.name).toBe("Masonry");
    expect(mas.remaining).toBeCloseTo(2_500 - 1_200.5 - 310.75, 2);
  });

  it("puts a code with no digits in the — group, and orders groups by code", () => {
    const g = railGroupsOf(rows);
    expect(g.find((x) => x.code === "—")?.used).toBe(89.99);
    expect(g.filter((x) => x.code !== "—").map((x) => x.code)).toEqual(["04", "09"]);
  });

  it("an over-budget division reads negative remaining", () => {
    const g = railGroupsOf([rows[0]]);
    expect(g[0].remaining).toBe(-700);
  });
});

describe("isDivisionLevelCode", () => {
  it("is a code with zeros after the first two digits", () => {
    expect(isDivisionLevelCode("04 00 00")).toBe(true);
    expect(isDivisionLevelCode("260000")).toBe(true);
    expect(isDivisionLevelCode("04 20 00")).toBe(false);
    expect(isDivisionLevelCode("04")).toBe(false);
    expect(isDivisionLevelCode("")).toBe(false);
  });
});

describe("tightestCodesOf — the phone's headroom rail", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    hr({ code: `0${i} 10 00`, budget: 1_000 * (i + 1), spent: 900 * (i + 1) + (i === 3 ? 2_000 : 0) }),
  );
  rows.push(hr({ code: "01 31 20", budget: 0, labor: 976 })); // unbudgeted: never listed
  rows.push(hr({ code: "99 00 00", budget: -500 })); // negative budget: never listed

  it("ranks by dollars left, fewest first, and takes eight", () => {
    const t = tightestCodesOf(rows, false);
    expect(t).toHaveLength(8);
    // Code 03 is $1,600 over: first. Then 100, 200, … left.
    expect(t[0].code).toBe("03 10 00");
    expect(t.slice(1, 3).map((h) => h.code)).toEqual(["00 10 00", "01 10 00"]);
    expect(t.some((h) => h.budget <= 0)).toBe(false);
  });

  it("reversed, takes the eight with most left — different cards, not the same eight", () => {
    const t = tightestCodesOf(rows, true);
    expect(t[0].code).toBe("09 10 00");
    expect(t.map((h) => h.code)).not.toContain("03 10 00");
  });

  it("does not reorder the rail's own rows", () => {
    const before = rows.map((h) => h.code);
    tightestCodesOf(rows, false);
    expect(rows.map((h) => h.code)).toEqual(before);
  });
});

describe("timeHeadroomOf / remainingForCode — the budget-left chips", () => {
  const headroom = hmap(
    hr({ code: "09 64 00", name: "Wood Flooring", budget: 10_000, spent: 4_000, drafts: 500, labor: 1_000 }),
    hr({ code: "01 31 20", name: "Supervision", labor: 976.25 }),
  );

  it("counts drafts and labor against the budget", () => {
    expect(timeHeadroomOf(headroom, "09 64 00")).toEqual({ name: "Wood Flooring", remaining: 4_500 });
    expect(remainingForCode(headroom, "09 64 00")).toBe(4_500);
  });

  it("a labor-only code reads over budget", () => {
    expect(timeHeadroomOf(headroom, "01 31 20")?.remaining).toBe(-976.25);
    expect(remainingForCode(headroom, "01 31 20")).toBe(-976.25);
  });

  it("is null for a code with no row", () => {
    expect(timeHeadroomOf(headroom, "88 80 00")).toBeNull();
    expect(remainingForCode(headroom, "")).toBeNull();
  });
});

describe("laneRowsOf — the By cost code view", () => {
  const bills = [
    bill({ id: "A", cost: 1_276.23, vendor: "Dunn Lumber", status: "approved", invoiced: true }),
    bill({ id: "B", cost: 340.21, vendor: "Sunset Builders Supply" }),
  ];
  const lines = [
    ln({ id: "a1", docId: "A", cost: 600, code: "06 10 00" }),
    ln({ id: "a2", docId: "A", cost: 650.48, code: "06 10 00" }),
    ln({ id: "a3", docId: "A", cost: -76.23, code: "06 20 00" }),
    ln({ id: "aT", docId: "A", cost: 102.98, code: "88 80 00", name: "Sales Tax" }),
    ln({ id: "b1", docId: "B", cost: 312.4, code: "06 10 00" }),
    ln({ id: "b2", docId: "B", cost: 0, code: "" }),
    ln({ id: "orphan", docId: "Q", cost: 55, code: "06 20 00", name: "Freight", billStatus: "pending" }),
  ];
  const headroom = hmap(hr({ code: "06 10 00", budget: 20_000 }));
  const staged: Record<string, string> = { b1: "06 20 00" };
  const codeOf = (l: JobBillLine) => staged[l.id] ?? l.code;

  it("stacks a bill's lines per code and sums the lane, staged moves included", () => {
    const lanes = laneRowsOf(lines, bills, codeOf, headroom);
    const rough = lanes.find((x) => x.code === "06 10 00")!;
    expect(rough.stacks).toHaveLength(1);
    expect(rough.stacks[0]).toMatchObject({ key: "06 10 00/A", cost: 1_250.48, label: "Dunn Lumber", invoiced: true });
    expect(rough.total).toBe(1_250.48);
    expect(rough.h?.budget).toBe(20_000);

    const finish = lanes.find((x) => x.code === "06 20 00")!;
    // Biggest stack first; a credit sorts last.
    expect(finish.stacks.map((s) => s.docId)).toEqual(["B", "Q", "A"]);
    expect(finish.total).toBeCloseTo(312.4 + 55 - 76.23, 2);
    expect(finish.h).toBeUndefined();
  });

  it("names a stack whose bill is not loaded by its first line", () => {
    const lanes = laneRowsOf(lines, bills, codeOf, headroom);
    const q = lanes.find((x) => x.code === "06 20 00")!.stacks.find((s) => s.docId === "Q")!;
    expect(q).toMatchObject({ label: "Freight", status: "pending", invoiced: false });
  });

  it("gives the sales-tax line its own lane and an uncoded line the (uncoded) lane", () => {
    const lanes = laneRowsOf(lines, bills, codeOf, headroom);
    expect(lanes.find((x) => x.code === "88 80 00")?.total).toBe(102.98);
    expect(lanes.find((x) => x.code === "(uncoded)")?.total).toBe(0);
  });

  it("lane totals add back to every line on the board", () => {
    const lanes = laneRowsOf(lines, bills, codeOf, headroom);
    const all = lanes.reduce((s, x) => s + x.total, 0);
    expect(all).toBeCloseTo(lines.reduce((s, l) => s + l.cost, 0), 2);
  });
});

describe("allTimeRingRowsOf / jobToDateTotal — the Jobs page's All Time figure", () => {
  const headroom = hmap(hr({ code: "09 64 00", name: "Wood Flooring" }));

  it("is null until the whole-job read arrives", () => {
    expect(allTimeRingRowsOf(null, headroom)).toBeNull();
  });

  it("sums bills and labor per code, named off the rail", () => {
    const rows = allTimeRingRowsOf(
      {
        bills: [
          { code: "09 64 00", cost: 4_000 },
          { code: "09 64 00", cost: -312.5 },
          { code: "06 10 00", cost: 1_250.48 },
        ],
        time: [
          { code: "09 64 00", cost: 1_000 },
          { code: "01 31 20", cost: 976.25 },
        ],
      },
      headroom,
    )!;
    expect(rows).toEqual([
      { code: "09 64 00", name: "Wood Flooring", bills: 3_687.5, labor: 1_000 },
      { code: "06 10 00", name: "", bills: 1_250.48, labor: 0 },
      { code: "01 31 20", name: "", bills: 0, labor: 976.25 },
    ]);
    expect(jobToDateTotal(rows)).toBeCloseTo(3_687.5 + 1_000 + 1_250.48 + 976.25, 2);
  });

  it("drops a code whose bills and labor are both exactly zero", () => {
    const rows = allTimeRingRowsOf(
      { bills: [{ code: "06 10 00", cost: 500 }, { code: "06 10 00", cost: -500 }], time: [] },
      headroom,
    )!;
    expect(rows).toEqual([]);
    expect(jobToDateTotal(rows)).toBe(0);
  });

  it("leaves uncoded cost out of Job to date", () => {
    // NOTE: possible bug — an uncoded bill line or time entry (code "") is
    // skipped, so the "Job to date" headline is short by that amount.
    const rows = allTimeRingRowsOf(
      { bills: [{ code: "", cost: 2_400 }, { code: "06 10 00", cost: 100 }], time: [{ code: "", cost: 88 }] },
      headroom,
    )!;
    expect(jobToDateTotal(rows)).toBe(100);
  });
});

describe("billCodeAmounts — one bill row's per-code figures", () => {
  it("sums the bill's lines per current code and counts staged moves", () => {
    const lines = [
      ln({ id: "a1", docId: "A", cost: 600, code: "06 10 00" }),
      ln({ id: "a2", docId: "A", cost: 650.48, code: "06 10 00" }),
      ln({ id: "a3", docId: "A", cost: -76.23, code: "06 20 00" }),
      ln({ id: "a4", docId: "A", cost: 0, code: "" }),
    ];
    const staged = new Map([["a2", "leaf-0620"]]);
    const codeOf = (l: JobBillLine) => (staged.has(l.id) ? "06 20 00" : l.code);
    const { codes, movedHere } = billCodeAmounts(lines, codeOf, staged);
    expect(codes.get("06 10 00")).toBe(600);
    expect(codes.get("06 20 00")).toBeCloseTo(574.25, 2);
    expect(codes.get("")).toBe(0);
    expect(movedHere).toBe(1);
  });

  it("is empty for a bill with no codeable lines", () => {
    const { codes, movedHere } = billCodeAmounts([], () => "", new Map());
    expect(codes.size).toBe(0);
    expect(movedHere).toBe(0);
  });
});

describe("hoursLabel — the labor block's hours", () => {
  it("drops .0 and keeps one decimal otherwise", () => {
    expect(hoursLabel(350)).toBe("350 hrs");
    expect(hoursLabel(349.8)).toBe("349.8 hrs");
    expect(hoursLabel(349.84)).toBe("349.8 hrs");
    expect(hoursLabel(349.96)).toBe("350 hrs");
    expect(hoursLabel(0)).toBe("0 hrs");
  });

  it("rounds a half tenth up", () => {
    // 0.25 * 10 is exactly 2.5 and 349.95 * 10 is exactly 3499.5 in a double.
    expect(hoursLabel(0.25)).toBe("0.3 hrs");
    expect(hoursLabel(349.95)).toBe("350 hrs");
  });

  it("sums of quarter hours read cleanly", () => {
    const week = [8, 7.75, 8.25, 6.5, 9.5].reduce((s, h) => s + h, 0);
    expect(hoursLabel(week)).toBe("40 hrs");
  });
});
