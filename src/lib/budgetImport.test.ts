import { describe, expect, it } from "vitest";
import {
  canonGroup,
  placeItem,
  planBudgetImport,
  planHash,
  resolveChoices,
  unitPriceFor,
  type BudgetLeaf,
  type SheetItem,
} from "./budgetImport";

// Shapes taken from job 002 (Bunkhouse), whose budget was typed in by hand.
const TT = new Set(["Labor", "Allowance"]);

const item = (p: Partial<SheetItem> & { name: string; codeNumber: string }): SheetItem => ({
  costGroup: "01 General Requirements",
  description: "",
  quantity: "",
  unit: "Allowance",
  unitCost: 0,
  costType: "Allowance",
  costCode: p.codeNumber,
  ...p,
});
const leaf = (p: Partial<BudgetLeaf> & { id: string; name: string; code: string }): BudgetLeaf => ({
  costType: "Other",
  unit: "Allowance",
  quantity: null,
  unitCost: 0,
  unitPrice: null,
  timeEntries: 0,
  ...p,
});

const sheet: SheetItem[] = [
  item({ name: "01 31 30 Consumables", codeNumber: "01 31 30", unitCost: 3000 }),
  item({ name: "01 51 20 Construction Waste", codeNumber: "01 51 20", costType: "Materials", unit: "Months", quantity: 12, unitCost: 250 }),
  item({ name: "07 46 23 Wood Siding - Materials", codeNumber: "07 46 23", costType: "Materials", unit: "Square Feet", quantity: 2900, unitCost: 5 }),
  item({ name: "07 46 23 Wood Siding - Labor", codeNumber: "07 46 23", costType: "Labor", unit: "Hours", quantity: 480, unitCost: 75 }),
  item({ name: "01 71 13 Mobilization", codeNumber: "01 71 13", costType: "Labor", unit: "Hours", quantity: 64, unitCost: 65 }),
  item({ name: "22 10 00 Plumbing Rough-in - Sub", codeNumber: "22 10 00", costType: "Subcontractor", unitCost: 8400 }),
  item({ name: "22 10 00 Plumbing Rough-in - Vendor", codeNumber: "22 10 00", costType: "Subcontractor", unitCost: 600 }),
  item({ name: "48 20 00 Solar System", codeNumber: "48 20 00", unitCost: 10000 }),
];
const leaves: BudgetLeaf[] = [
  leaf({ id: "c", name: "01 31 30 Consumables", code: "01 31 30", costType: "Materials", unitCost: 3000, unitPrice: 3540 }),
  leaf({ id: "w1", name: "01 51 20 Construction Waste", code: "01 51 20", unit: "Months", quantity: 12, unitCost: 250 }),
  leaf({ id: "w2", name: "01 51 20 Construction Waste", code: "01 51 20", costType: "Labor", unit: "Months", quantity: 12, unitCost: 250, timeEntries: 2 }),
  leaf({ id: "s1", name: "07 46 23 Wood Siding", code: "07 46 23", unit: "Square Feet", quantity: 2900, unitCost: 5, unitPrice: 5.9 }),
  leaf({ id: "s2", name: "07 46 23 Wood Siding -Labor", code: "07 46 23", costType: "Labor", unit: "Hours", quantity: 480, unitCost: 75, unitPrice: 88.5, timeEntries: 99 }),
  // Carries time entries, and the sheet asks for a type that cannot hold them.
  leaf({ id: "m", name: "01 71 13 Mobilization", code: "01 71 13", costType: "Labor", unit: "Hours", quantity: 64, unitCost: 65, unitPrice: 76.7, timeEntries: 5 }),
  // A re-sync: both names match exactly, so two items of one type still pair.
  leaf({ id: "p1", name: "22 10 00 Plumbing Rough-in - Sub", code: "22 10 00", costType: "Subcontractor", unitCost: 8400, unitPrice: 9912 }),
  leaf({ id: "p2", name: "22 10 00 Plumbing Rough-in - Vendor", code: "22 10 00", costType: "Subcontractor", unitCost: 500, unitPrice: 590 }),
  leaf({ id: "sel", name: "RS 6\" TNG Cedar", code: "01 00 00", costType: "Materials" }),
  leaf({ id: "u", name: "Uncategorized 01 31 30", code: "01 31 30" }),
];

describe("planBudgetImport", () => {
  const plan = planBudgetImport(sheet, leaves, 18, TT);
  const row = (name: string) => plan.rows.find((r) => r.sheet.name === name)!;

  it("updates a one-to-one item in place, including a changed cost type", () => {
    const r = row("01 31 30 Consumables");
    expect(r.action).toBe("update");
    if (r.action !== "update") return;
    expect(r.target.id).toBe("c");
    expect(r.changes).toEqual([{ field: "costType", before: "Materials", after: "Allowance" }]);
  });

  it("asks when one sheet item faces two JobTread items on its code", () => {
    const r = row("01 51 20 Construction Waste");
    expect(r.action).toBe("choose");
    if (r.action === "choose") expect(r.candidates.map((l) => l.id)).toEqual(["w1", "w2"]);
  });

  it("pairs a hand-typed line on its cost, and gives it the sheet's name", () => {
    const labor = row("07 46 23 Wood Siding - Labor");
    const mat = row("07 46 23 Wood Siding - Materials");
    expect(labor.action === "update" && labor.target.id).toBe("s2");
    if (labor.action === "update") {
      expect(labor.changes).toEqual([{ field: "name", before: "07 46 23 Wood Siding -Labor", after: "07 46 23 Wood Siding - Labor" }]);
    }
    expect(mat.action === "update" && mat.target.id).toBe("s1");
    if (mat.action === "update") expect(mat.changes.map((c) => c.field)).toEqual(["name", "costType"]);
  });

  it("pairs on cost before type, so a $0 placeholder never wins over the real line", () => {
    // Job 002's Mobilization: $4,160 typed Other, beside a $0 Labor placeholder.
    const p = planBudgetImport(
      [item({ name: "01 71 13 Mobilization", codeNumber: "01 71 13", costType: "Labor", unit: "Hours", quantity: 64, unitCost: 65 })],
      [
        leaf({ id: "real", name: "01 71 13 Mobilization", code: "01 71 13", unit: "Hours", quantity: 64, unitCost: 65, unitPrice: 76.7 }),
        leaf({ id: "zero", name: "01 71 13 Mobilization", code: "01 71 13", costType: "Labor", unit: "Hours", unitCost: null }),
      ],
      18,
      TT,
    );
    const r = p.rows[0];
    expect(r.action === "update" && r.target.id).toBe("real");
    if (r.action === "update") expect(r.changes).toEqual([{ field: "costType", before: "Other", after: "Labor" }]);
    expect(p.untouched.map((l) => l.id)).toEqual(["zero"]);
  });

  it("never matches a selection, and lists one only when it carries a cost", () => {
    const p = planBudgetImport(
      [item({ name: "09 91 13 Exterior Painting", codeNumber: "09 91 13", unitCost: 15000 })],
      [
        leaf({ id: "pick", name: "Raccoon Fur", code: "09 91 13", costType: "Materials", selection: true }),
        leaf({ id: "paid", name: "Upgraded stain", code: "09 91 13", costType: "Materials", unitCost: 300, selection: true }),
      ],
      18,
      TT,
    );
    expect(p.rows[0].action).toBe("create");
    expect(p.untouched.map((l) => l.id)).toEqual(["paid"]);
  });

  it("keeps the cost type of an item that carries time entries", () => {
    const r = planBudgetImport(
      [item({ name: "01 71 13 Mobilization", codeNumber: "01 71 13", costType: "Materials", unit: "Hours", quantity: 64, unitCost: 65 })],
      leaves,
      18,
      TT,
    ).rows[0];
    expect(r.action).toBe("unchanged");
    if (r.action === "unchanged") expect(r.keptType).toBe("Materials");
  });

  it("matches by name on a re-sync and writes only what moved", () => {
    const sub = row("22 10 00 Plumbing Rough-in - Sub");
    const ven = row("22 10 00 Plumbing Rough-in - Vendor");
    expect(sub.action).toBe("unchanged");
    expect(ven.action === "update" && ven.target.id).toBe("p2");
    if (ven.action === "update") {
      expect(ven.changes).toEqual([
        { field: "unitCost", before: 500, after: 600 },
        { field: "unitPrice", before: 590, after: 708 },
      ]);
    }
  });

  it("creates what the job does not have, and leaves the rest alone", () => {
    expect(row("48 20 00 Solar System").action).toBe("create");
    // w1/w2 are only candidates until someone picks; the rollup is never listed.
    expect(plan.untouched.map((l) => l.id).sort()).toEqual(["sel", "w1", "w2"]);
  });
});

describe("resolveChoices", () => {
  const plan = planBudgetImport(sheet, leaves, 18, TT);
  const key = plan.rows.find((r) => r.action === "choose")!.key;

  it("turns a pick into an update, or into a create", () => {
    const upd = resolveChoices(plan, { [key]: "w1" }, 18, TT).find((r) => r.key === key)!;
    expect(upd.action === "update" && upd.changes).toEqual([
      { field: "unitPrice", before: null, after: 295 },
      { field: "costType", before: "Other", after: "Materials" },
    ]);
    expect(resolveChoices(plan, { [key]: "new" }, 18, TT).find((r) => r.key === key)!.action).toBe("create");
  });

  it("refuses a missing pick, a stranger, and an item already taken", () => {
    expect(() => resolveChoices(plan, {}, 18, TT)).toThrow(/Choose what/);
    expect(() => resolveChoices(plan, { [key]: "s1" }, 18, TT)).toThrow(/not one of its choices/);
    const twice = planBudgetImport(
      [sheet[1], { ...sheet[1], name: "01 51 20 Construction Waste - 2" }],
      leaves,
      18,
      TT,
    );
    const keys = twice.rows.map((r) => r.key);
    expect(() => resolveChoices(twice, { [keys[0]]: "w1", [keys[1]]: "w1" }, 18, TT)).toThrow(/Two sheet items/);
  });
});

describe("pricing and the stale-preview guard", () => {
  it("prices from cost and markup", () => {
    expect(unitPriceFor(3360, 18)).toBe(3964.8);
    expect(unitPriceFor(75, 0)).toBe(75);
  });

  it("fingerprints the inputs, not the order JobTread returned them in", () => {
    const h = planHash(sheet, leaves, 18);
    expect(planHash(sheet, [...leaves].reverse(), 18)).toBe(h);
    expect(planHash(sheet, leaves, 20)).not.toBe(h);
    // Someone logging an hour between preview and write must not refuse it.
    expect(planHash(sheet, leaves.map((l) => ({ ...l, timeEntries: l.timeEntries + 1 })), 18)).toBe(h);
    expect(planHash(sheet, leaves.map((l) => (l.id === "c" ? { ...l, unitCost: 1 } : l)), 18)).not.toBe(h);
  });
});

describe("placeItem — where a created item goes", () => {
  // Gormley Studio's own layout: groups carry no number.
  const groups = [
    { id: "concrete", name: "Concrete", parentId: null },
    { id: "footings", name: "Cast-in-Place Concrete Footings & Foundations", parentId: "concrete" },
    { id: "openings", name: "Openings", parentId: null },
    { id: "thermal", name: "Thermal & Moisture Protection", parentId: null },
    { id: "damp", name: "Damp proofing and Waterproofing", parentId: "thermal" },
    { id: "furnishings", name: "Furnishings", parentId: null },
    { id: "uncat", name: "Uncategorized", parentId: null },
  ];
  const live = [
    leaf({ id: "lc", name: "03 99 99 Lead Carpenter", code: "03 99 99", unitCost: 3040, groupId: "concrete" }),
    leaf({ id: "ft", name: "03 30 00 Footings - Sub", code: "03 30 00", unitCost: 15000, groupId: "footings" }),
    leaf({ id: "win", name: "08 50 00 Windows - Labor", code: "08 50 00", unitCost: 5760, groupId: "openings" }),
    leaf({ id: "dp", name: "07 10 00 Dampproofing - Labor", code: "07 10 00", unitCost: 7680, groupId: "damp" }),
    leaf({ id: "u", name: "Uncategorized 12 00 00", code: "12 99 99", groupId: "uncat" }),
  ];
  const place = (name: string, codeNumber: string, costGroup: string) =>
    placeItem(item({ name, codeNumber, costGroup }), live, groups);

  it("sets a row's new bucket beside its existing one", () => {
    expect(place("08 50 00 Windows - Allowance", "08 50 00", "08 Openings; 08 50 00 Windows")).toEqual({ groupId: "openings" });
    expect(place("07 10 00 Dampproofing - Allowance", "07 10 00", "07 Thermal and Moisture Protection; 07 10 00 Dampproofing and Waterproofing")).toEqual({ groupId: "damp" });
  });

  it("uses the division's existing home, never a second '03 Concrete'", () => {
    expect(place("07 27 00 Air Barriers", "07 27 00", "07 Thermal and Moisture Protection")).toEqual({ groupId: "thermal" });
    expect(place("03 30 10 Slabs - Sub", "03 30 10", "03 Concrete; 03 30 10 Cast-in-Place Concrete Slabs")).toEqual({
      parentId: "concrete",
      create: ["03 30 10 Cast-in-Place Concrete Slabs"],
    });
  });

  it("falls back to the same name with the numbers set aside, then creates", () => {
    // Only an Uncategorized rollup sits in 12 — it is no home.
    expect(place("12 99 99 Lead Carpenter 12", "12 99 99", "12 Furnishings")).toEqual({ groupId: "furnishings" });
    expect(place("48 20 00 Solar System", "48 20 00", "48 Electrical Power Generation")).toEqual({
      parentId: null,
      create: ["48 Electrical Power Generation"],
    });
    expect(canonGroup("07 Thermal and Moisture Protection")).toBe(canonGroup("Thermal & Moisture Protection"));
    expect(canonGroup("07 10 00 Dampproofing and Waterproofing")).toBe("dampproofingandwaterproofing");
  });
});
