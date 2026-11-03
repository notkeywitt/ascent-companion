import { describe, expect, it } from "vitest";

import {
  PUNCH_TEMPLATE,
  applyPunchOp,
  asPunchOp,
  asPunchState,
  emptyPunchState,
  punchRows,
} from "./punchList";

const first = PUNCH_TEMPLATE[0].items[0].key;

describe("the punch list template", () => {
  it("gives every item its own key", () => {
    const keys = PUNCH_TEMPLATE.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the 11 sections of the inspection checklist", () => {
    expect(PUNCH_TEMPLATE).toHaveLength(11);
  });
});

describe("applyPunchOp", () => {
  it("ticks an item with who and when, and clears it", () => {
    const s = applyPunchOp(emptyPunchState(), { op: "check", key: first, done: true }, "a@x", "t1");
    expect(s.done[first]).toEqual({ by: "a@x", at: "t1" });
    expect(applyPunchOp(s, { op: "check", key: first, done: false }, "a@x", "t2").done).toEqual({});
  });

  it("hides and shows an item", () => {
    const s = applyPunchOp(emptyPunchState(), { op: "hide", key: first, hidden: true }, "", "");
    expect(punchRows(s)[0].rows[0].hidden).toBe(true);
    expect(applyPunchOp(s, { op: "hide", key: first, hidden: false }, "", "").hidden).toEqual([]);
  });

  it("adds an item to the end of its section, and removes it", () => {
    const s = applyPunchOp(emptyPunchState(), { op: "add", key: "c-1", section: "plumbing", text: "Fix tub" }, "", "");
    const plumbing = punchRows(s).find((x) => x.id === "plumbing")!;
    expect(plumbing.rows.at(-1)).toMatchObject({ key: "c-1", text: "Fix tub", custom: true });
    const ticked = applyPunchOp(s, { op: "check", key: "c-1", done: true }, "", "");
    expect(applyPunchOp(ticked, { op: "remove", key: "c-1" }, "", "")).toEqual(emptyPunchState());
  });

  it("never removes a template item, and ignores unknown keys", () => {
    const s = emptyPunchState();
    expect(applyPunchOp(s, { op: "remove", key: first }, "", "")).toBe(s);
    expect(applyPunchOp(s, { op: "check", key: "nope", done: true }, "", "")).toBe(s);
  });
});

describe("asPunchOp and asPunchState", () => {
  it("refuses an add with no text, a bad section or a template-style key", () => {
    expect(asPunchOp({ op: "add", key: "c-1", section: "plumbing", text: "  " })).toBeNull();
    expect(asPunchOp({ op: "add", key: "c-1", section: "nope", text: "x" })).toBeNull();
    expect(asPunchOp({ op: "add", key: first, section: "plumbing", text: "x" })).toBeNull();
  });

  it("reads junk as an empty list", () => {
    expect(asPunchState("junk")).toEqual(emptyPunchState());
  });
});
