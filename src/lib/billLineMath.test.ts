import { describe, expect, it } from "vitest";
import {
  billLineMath,
  descriptionForCode,
  grossUpNewLineUnitCost,
  round2,
  type MathLine,
  type CodeOption,
} from "./billLineMath";

/**
 * Bill line money maths — the tax-inclusive ↔ pre-tax conversion behind the
 * coding screen and the recode board.
 *
 * JobTread stores line costs TAX-INCLUSIVE. The UI shows pre-tax, and a save
 * grosses back up. Getting that round-trip wrong changes what a job is billed,
 * so the cases below are mostly about it being lossless when nothing is edited.
 */

const budget: CodeOption[] = [
  { id: "b1", number: "06 10 00", name: "Rough Carpentry" } as CodeOption,
  { id: "b2", number: "09 911 00", name: "Painting" } as CodeOption,
];

const line = (over: Partial<MathLine> = {}): MathLine =>
  ({
    id: "l1",
    name: "Lumber",
    quantity: 2,
    unitCost: 50,
    cost: 100,
    jobCostItemId: "b1",
    ...over,
  }) as MathLine;

const base = {
  storedTax: 0,
  status: "draft",
  edits: {},
  picked: {},
  budget,
};

describe("round2", () => {
  it("rounds to cents", () => {
    expect(round2(2.344)).toBe(2.34);
    expect(round2(2.346)).toBe(2.35);
    expect(round2(10)).toBe(10);
    expect(round2(-2.346)).toBe(-2.35);
  });

  it("inherits binary-float half-way behaviour (documented, not a bug)", () => {
    // A "…5" third decimal is usually NOT exactly half in a double: 1.005 * 100
    // is 100.49999999999999, so Math.round takes it DOWN. Whether a given value
    // lands above or below depends on its binary representation, not on the
    // decimal digits — 1.045 * 100 IS exactly 104.5 and rounds up.
    //
    // Every Math.round-based money rounder in JS behaves this way, including the
    // Apps Script side, so the two repos agree. Pinned so nobody "fixes" this
    // into a different rounding mode without realising it would make them differ.
    expect(round2(1.005)).toBe(1); // 100.49999999999999 → down
    expect(round2(1.015)).toBe(1.01); // 101.49999999999999 → down
    expect(round2(1.045)).toBe(1.05); // exactly 104.5      → up
    expect(round2(0.615)).toBe(0.62); // exactly  61.5      → up
  });
});

describe("billLineMath — de-tax / re-tax round trip", () => {
  it("is a no-op on a tax-free bill", () => {
    const m = billLineMath({ ...base, lines: [line()] });
    expect(m.deTax(100)).toBe(100);
    expect(m.reTax).toBe(1);
    expect(m.targets[0].preTaxUnit).toBe(50);
  });

  it("splits stored tax out of the displayed unit cost", () => {
    // One line, stored cost 110 of which 10 is tax → pre-tax unit is 100/1 = 100.
    const m = billLineMath({
      ...base,
      storedTax: 10,
      lines: [line({ quantity: 1, unitCost: 110, cost: 110 })],
    });
    expect(m.targets[0].preTaxUnit).toBeCloseTo(100, 6);
  });

  it("round-trips an untouched taxed bill back to its stored value", () => {
    // This is the important one: opening a bill and saving it unchanged must not
    // move any number.
    const m = billLineMath({
      ...base,
      storedTax: 10,
      lines: [line({ quantity: 1, unitCost: 110, cost: 110 })],
    });
    expect(m.wholeBillChanges[0].unitCost).toBeCloseTo(110, 2);
    expect(m.dirty).toBe(false);
    expect(m.pendingCount).toBe(0);
  });

  it("keeps the total equal to pre-tax subtotal plus tax", () => {
    const m = billLineMath({
      ...base,
      storedTax: 10,
      lines: [line({ quantity: 1, unitCost: 110, cost: 110 })],
    });
    expect(m.total).toBeCloseTo(m.subtotal + 10, 2);
  });

  it("an in-progress tax edit moves the total but NOT the line amounts", () => {
    const lines = [line({ quantity: 1, unitCost: 110, cost: 110 })];
    const before = billLineMath({ ...base, storedTax: 10, lines });
    const after = billLineMath({ ...base, storedTax: 10, taxView: 25, lines });
    expect(after.targets[0].preTaxUnit).toBeCloseTo(before.targets[0].preTaxUnit, 6);
    expect(after.total).not.toBeCloseTo(before.total, 2);
  });
});

describe("billLineMath — dirty tracking", () => {
  it("is clean with no edits", () => {
    const m = billLineMath({ ...base, lines: [line()] });
    expect(m.dirty).toBe(false);
    expect(m.pendingCount).toBe(0);
  });

  it("counts a re-coded line once", () => {
    const m = billLineMath({ ...base, lines: [line()], picked: { l1: "b2" } });
    expect(m.dirty).toBe(true);
    expect(m.pendingCount).toBe(1);
  });

  it("counts a line once even when several of its fields change", () => {
    const m = billLineMath({
      ...base,
      lines: [line()],
      picked: { l1: "b2" },
      edits: { l1: { name: "Different", quantity: "5", unitCost: "9" } },
    });
    expect(m.pendingCount).toBe(1);
  });

  it("counts each changed line separately", () => {
    const m = billLineMath({
      ...base,
      lines: [line(), line({ id: "l2" })],
      picked: { l1: "b2", l2: "b2" },
    });
    expect(m.pendingCount).toBe(2);
  });

  it("selecting the code a line already has is not a change", () => {
    const m = billLineMath({ ...base, lines: [line()], picked: { l1: "b1" } });
    expect(m.dirty).toBe(false);
  });

  it("ignores quantity/cost edits on a non-draft bill (JobTread locks them)", () => {
    const m = billLineMath({
      ...base,
      status: "approved",
      lines: [line()],
      edits: { l1: { quantity: "99", unitCost: "99" } },
    });
    expect(m.targets[0].qty).toBe(2);
    expect(m.dirty).toBe(false);
  });

  it("still allows RE-CODING a non-draft bill", () => {
    const m = billLineMath({
      ...base,
      status: "approved",
      lines: [line()],
      picked: { l1: "b2" },
    });
    expect(m.dirty).toBe(true);
    expect(m.wholeBillChanges[0].jobCostItemId).toBe("b2");
  });
});

describe("billLineMath — what a save sends", () => {
  it("sends every line, not just the edited ones", () => {
    const m = billLineMath({ ...base, lines: [line(), line({ id: "l2" })], picked: { l1: "b2" } });
    expect(m.wholeBillChanges.map((c) => c.costItemId).sort()).toEqual(["l1", "l2"]);
  });

  it("never writes an empty code onto an untouched uncoded line", () => {
    const m = billLineMath({ ...base, lines: [line({ jobCostItemId: undefined })] });
    expect(m.wholeBillChanges[0].jobCostItemId).toBeUndefined();
  });

  it("does write an explicit clear when the user picked one", () => {
    const m = billLineMath({
      ...base,
      lines: [line({ jobCostItemId: undefined })],
      picked: { l1: "" },
    });
    expect(m.wholeBillChanges[0].jobCostItemId).toBe("");
  });
});

describe("descriptionForCode", () => {
  it("resolves a budget leaf to its cost-code description", () => {
    expect(descriptionForCode("b1", budget)).toContain("06 10 00");
  });

  it("returns undefined for an unknown id, so nothing is overwritten", () => {
    expect(descriptionForCode("nope", budget)).toBeUndefined();
  });
});

describe("grossUpNewLineUnitCost", () => {
  it("is a no-op on a tax-free bill (factor 1)", () => {
    // subtotal 100, no tax, add 2 @ 50 pre-tax → stored == entered pre-tax.
    expect(grossUpNewLineUnitCost({ subtotal: 100, taxView: 0, preTaxUnit: 50, qty: 2 })).toBe(50);
  });

  it("grosses the new line up against the shared tax so JobTread stores tax-inclusive", () => {
    // subtotal 100 + new line 2@50 = 200 pre-tax; tax $10 spread over 200 → factor 1.05.
    expect(grossUpNewLineUnitCost({ subtotal: 100, taxView: 10, preTaxUnit: 50, qty: 2 })).toBe(52.5);
  });

  it("guards a zero pre-tax base (empty bill, zero qty) with factor 1 — no divide-by-zero", () => {
    expect(grossUpNewLineUnitCost({ subtotal: 0, taxView: 0, preTaxUnit: 50, qty: 0 })).toBe(50);
  });

  it("rounds the stored cost to cents", () => {
    // subtotal 33.33 + 1@10 = 43.33; tax $5 → factor (48.33/43.33); 10*factor rounded.
    const factor = (43.33 + 5) / 43.33;
    expect(grossUpNewLineUnitCost({ subtotal: 33.33, taxView: 5, preTaxUnit: 10, qty: 1 })).toBe(
      Math.round(10 * factor * 100) / 100,
    );
  });
});
