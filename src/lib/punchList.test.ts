import { describe, expect, it } from "vitest";

import {
  PUNCH_TEMPLATE,
  applyPunchOp,
  asPunchOp,
  asPunchState,
  emptyPunchState,
  punchComplete,
  punchRows,
  type PunchState,
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

describe("notes and the sign-off", () => {
  const sig = "data:image/png;base64,AAAA";
  const allDone = (): PunchState => {
    let s = emptyPunchState();
    for (const sec of PUNCH_TEMPLATE)
      for (const i of sec.items) s = applyPunchOp(s, { op: "check", key: i.key, done: true }, "", "");
    return s;
  };

  it("saves notes", () => {
    expect(applyPunchOp(emptyPunchState(), { op: "notes", text: "Rail at deck" }, "", "").notes).toBe("Rail at deck");
  });

  it("refuses a sign-off until every listed item is done", () => {
    const s = emptyPunchState();
    expect(applyPunchOp(s, { op: "sign", date: "2026-11-03", signature: sig }, "a", "t")).toBe(s);
    const signed = applyPunchOp(allDone(), { op: "sign", date: "2026-11-03", signature: sig }, "a", "t");
    expect(signed.signoff).toEqual({ date: "2026-11-03", signature: sig, by: "a", at: "t" });
    expect(applyPunchOp(signed, { op: "unsign" }, "", "").signoff).toBeNull();
  });

  it("counts a hidden item as off the list", () => {
    let s = allDone();
    s = applyPunchOp(s, { op: "check", key: first, done: false }, "", "");
    expect(punchComplete(s)).toBe(false);
    expect(punchComplete(applyPunchOp(s, { op: "hide", key: first, hidden: true }, "", ""))).toBe(true);
  });

  it("refuses a sign-off with no date or a non-PNG signature", () => {
    expect(asPunchOp({ op: "sign", date: "", signature: sig })).toBeNull();
    expect(asPunchOp({ op: "sign", date: "2026-11-03", signature: "javascript:x" })).toBeNull();
  });
});
