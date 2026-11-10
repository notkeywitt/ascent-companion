import { describe, expect, it } from "vitest";

import {
  colLetter,
  compareTrackingSheet,
  findInvoiceColumns,
  parseMoney,
  readLabor,
  readSubVendor,
  totalJtLabor,
  totalJtLines,
  type Grid,
} from "./sheetCompare";

// Berger Bunkhouse, October 2026 — the Sub/Vendor tab as get_values returned
// it on 2026-11-10 (header row trimmed to the codes that matter here).
// Row 1 is BOTH a data row (A:C) and the code header (E on).
const header = ["01 31 30", "$202.17", "Sunset Builders Supply", "", "01 31 30", "01 51 10", "01 51 20", "22 20 00"];
const bunkhouse: Grid = [
  header,
  ["01 51 10", "$300.00", "Starr Sanitation Services", "", " $ 202.17 ", " $ 300.00 ", " $ 860.85 ", "$21,795.00"],
  ["01 51 20", "$860.85", "LSWDD"],
  ["06 10 10", "-$277.77", "Sunset Builders Supply"],
  ["22 20 00", "$21,795.00", "Preferred Plumbing"],
  [],
  ["", "", "", "", "$202.17", "$300.00", "$860.85", "$21,795.00"],
];

const bills = [
  { id: "s1", label: "INV-5b7544a0", vendor: "Starr Sanitation Services", status: "draft" },
  { id: "s2", label: "INV-20d0d727", vendor: "Starr Sanitation Services", status: "draft" },
  { id: "l1", label: "LSWDD-2026-11-01", vendor: "LSWDD", status: "approved" },
  { id: "p1", label: "2740-2", vendor: "Preferred Plumbing", status: "pending" },
  { id: "c1", label: "719230", vendor: "Sunset Builders Supply", status: "draft" },
  { id: "x1", label: "721000", vendor: "Sunset Builders Supply", status: "draft" },
  { id: "c2", label: "714238", vendor: "Sunset Builders Supply", status: "draft" },
];
const lines = [
  { docId: "s1", code: "01 51 10", name: "Portable toilet", cost: 300 },
  { docId: "s2", code: "01 51 10", name: "Portable toilet", cost: 100 },
  { docId: "l1", code: "01 51 20", name: "Dump", cost: 860.85 },
  { docId: "p1", code: "22 20 00", name: "Rough-in", cost: 21795 },
  { docId: "c1", code: "06 10 10", name: "Return", cost: -277.77 },
  { docId: "x1", code: "88 80 00", name: "Sales Tax", cost: 12.5 },
  { docId: "c2", code: "01 31 30", name: "Consumables", cost: 202.17 },
];

describe("parseMoney", () => {
  it("reads the sheet's money formats", () => {
    expect(parseMoney("$1,008.72")).toBe(1008.72);
    expect(parseMoney("-$277.77")).toBe(-277.77);
    expect(parseMoney("($20.64)")).toBe(-20.64);
    expect(parseMoney(" $ 202.17 ")).toBe(202.17);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(42)).toBe(42);
  });
});

describe("colLetter", () => {
  it("counts like the sheet", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(145)).toBe("EP");
  });
});

describe("JobTread side", () => {
  it("leaves sales tax out, the way the sync does", () => {
    const jt = totalJtLines(bills, lines);
    expect(jt.excluded.salesTax).toBe(12.5);
    expect(jt.byCode["01 51 10"].total).toBe(400);
    expect(jt.total).toBe(22980.25);
  });
});

describe("Sub/Vendor tab", () => {
  it("finds the rows, the columns and the totals row", () => {
    const sv = readSubVendor(bunkhouse);
    expect(sv.rows["01 51 10"]).toBe(300);
    expect(sv.columns["01 51 20"]).toBe("G");
    expect(sv.columnTotals.G).toBe(860.85);
  });
});

describe("compareTrackingSheet — bills", () => {
  it("names the $100 Starr bill the sync missed", () => {
    const r = compareTrackingSheet({ year: 2026, month: 10, jt: totalJtLines(bills, lines), subVendor: bunkhouse });
    expect(r.difference).toBe(100);
    const miss = r.issues.filter((i) => i.kind === "not-synced");
    expect(miss).toHaveLength(1);
    expect(miss[0].code).toBe("01 51 10");
    expect(miss[0].lines?.map((l) => l.bill)).toContain("INV-20d0d727");
  });

  it("flags a code with rows but no column", () => {
    const r = compareTrackingSheet({ year: 2026, month: 10, jt: totalJtLines(bills, lines), subVendor: bunkhouse });
    expect(r.issues.find((i) => i.kind === "no-column")?.code).toBe("06 10 10");
  });

  it("finds the totals row above helper rows", () => {
    const g = bunkhouse.map((row) => [...(row ?? [])]);
    g.push(["", "", "", "", "", "", "", "", "TRUE"], ["", "", "", "", "", "", "", "", "$99,999.00"]);
    expect(readSubVendor(g).columnTotals.G).toBe(860.85);
  });

  it("ignores a repeated header code that carries no money", () => {
    const g = bunkhouse.map((row) => [...(row ?? [])]);
    g[0].push("22 00 00", "22 00 00");
    const r = compareTrackingSheet({ year: 2026, month: 10, jt: totalJtLines(bills, lines), subVendor: g });
    expect(r.issues.some((i) => i.code === "22 00 00")).toBe(false);
  });

  it("flags a column whose total does not match its rows", () => {
    const broken = bunkhouse.map((row) => [...(row ?? [])]);
    broken[6][6] = "$0.00";
    const r = compareTrackingSheet({ year: 2026, month: 10, jt: totalJtLines(bills, lines), subVendor: broken });
    const off = r.issues.find((i) => i.kind === "column-total-off");
    expect(off?.code).toBe("01 51 20");
  });
});

// Berger Main House, October 2026 — the Labor tab as get_values returned it,
// and JobTread's entries grouped by code and rate the same day.
const laborTab: Grid = [
  ["October '26 Labor", "Kevin Berger - Main House"],
  ["", "sum ", "min ", "max ", "cost per hour", "total"],
  ["01 31 10", "7", "10/5/2026", "10/23/2026", "$85.00", "$595.00", "", "Total Labor Time", "111.68"],
  ["01 31 20", "32.26", "10/20/2026", "10/28/2026", "$75.00", "$2,419.50", "", "Total Labor Cost", "$9,357.25"],
  ["06 10 00", "36.5", "10/20/2026", "10/30/2026", "$75.00", "$2,737.50"],
  ["06 15 00", "15.67", "10/22/2026", "10/26/2026", "$75.00", "$1,175.25"],
  ["26 30 00", "20.25", "10/16/2026", "10/29/2026", "$120.00", "$2,430.00"],
];
const entries = [
  { code: "01 31 10", hours: 7, cost: 595, hourlyRate: 85, employee: "A" },
  { code: "01 31 20", hours: 1936 / 60, cost: 2420, hourlyRate: 75, employee: "B" },
  { code: "06 10 00", hours: 36.5, cost: 2737.5, hourlyRate: 75, employee: "B" },
  { code: "06 15 00", hours: 940 / 60, cost: 1331.67, hourlyRate: 85, employee: "A" },
  { code: "26 30 00", hours: 20.25, cost: 2430, hourlyRate: 120, employee: "C" },
];

describe("compareTrackingSheet — labor", () => {
  const run = (tab: Grid) =>
    compareTrackingSheet({
      year: 2026,
      month: 10,
      jt: totalJtLines([], []),
      jtLabor: totalJtLabor(entries),
      subVendor: [[]],
      labor: tab,
    });

  it("finds the 06 15 00 rate gap and treats 01 31 20 as rounding", () => {
    const r = run(laborTab);
    const labor = r.issues.filter((i) => i.kind.startsWith("labor"));
    expect(labor).toHaveLength(1);
    expect(labor[0].kind).toBe("labor-rate-off");
    expect(labor[0].code).toBe("06 15 00");
    expect(labor[0].detail).toContain("$85.00");
    expect(r.laborSheet?.cost).toBe(9357.25);
  });

  it("reads the tab's own totals", () => {
    const lab = readLabor(laborTab);
    expect(lab.statedCost).toBe(9357.25);
    expect(lab.statedHours).toBe(111.68);
  });

  it("flags a Total Labor Cost that misses a row", () => {
    const broken = laborTab.map((row) => [...(row ?? [])]);
    broken[3][8] = "$6,927.25";
    expect(run(broken).issues.some((i) => i.kind === "labor-total-off")).toBe(true);
  });

  it("flags a row whose hours × rate is not its total", () => {
    const broken = laborTab.map((row) => [...(row ?? [])]);
    broken[4][5] = "$2,000.00";
    expect(run(broken).issues.some((i) => i.kind === "labor-row-math" && i.code === "06 10 00")).toBe(true);
  });
});

describe("findInvoiceColumns", () => {
  it("finds the CURRENT INVOICE block and the month's block", () => {
    const h: Grid = [
      ["", "", "", "", "", "", "", "", "CURRENT INVOICE"],
      ["", "October '26"],
      ["", "LABOR", "INVOICES", "CONTINGENCY", "TOTAL", "", "", "", "LABOR", "INVOICES"],
    ];
    const c = findInvoiceColumns(h, 2026, 10);
    expect(c.current).toEqual({ labor: "I", invoices: "J" });
    expect(c.month).toEqual({ labor: "B", invoices: "C" });
  });

  it("compares the Tracking Sheet tab's cells to what feeds them", () => {
    const h: Grid = [["", "", "CURRENT INVOICE"], [], ["", "", "LABOR", "INVOICES"]];
    const r = compareTrackingSheet({
      year: 2026,
      month: 10,
      jt: totalJtLines(bills, lines),
      subVendor: bunkhouse,
      headers: h,
      codes: [["01 51 10"], ["01 51 20"], ["22 20 00"]],
      columns: { D: [["$300.00"], ["$0.00"], ["$21,795.00"]] },
    });
    const off = r.issues.filter((i) => i.kind === "tracking-tab-off");
    expect(off).toHaveLength(1);
    expect(off[0].code).toBe("01 51 20");
    expect(off[0].where).toBe("Tracking Sheet D11");
  });
});
