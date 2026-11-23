import { describe, expect, it } from "vitest";
import {
  PRECON_TEMPLATE,
  applyPreconOp,
  asPreconOp,
  asPreconState,
  emptyPreconState,
  preconProgress,
  preconRows,
  preconStarted,
  type PreconOp,
  type PreconState,
} from "./preconChecklist";

const AT = "2026-11-23T17:00:00.000Z";
const apply = (s: PreconState, ...ops: PreconOp[]) => ops.reduce((x, op) => applyPreconOp(x, op, "ty@ascentbuildingco.com", AT), s);
const key = (phase: number, step: number) => PRECON_TEMPLATE[phase].steps[step].key;

describe("the template", () => {
  it("is the sheet's 27 steps in the Overview's four phases", () => {
    expect(PRECON_TEMPLATE.map((p) => [p.title, p.steps.length])).toEqual([
      ["Design Development", 7],
      ["Permit Set", 11],
      ["Construction Documents", 5],
      ["Contract & Mobilization", 4],
    ]);
    expect(PRECON_TEMPLATE[0].steps[0].text).toBe("Study and assessment of Design Development set of plans");
    expect(PRECON_TEMPLATE[3].steps[2].text).toBe("Send request to customer to pay 10% deposit");
  });
  it("gives every step its own key", () => {
    const keys = PRECON_TEMPLATE.flatMap((p) => p.steps.map((s) => s.key));
    expect(new Set(keys).size).toBe(27);
    expect(key(2, 0)).toBe("cd.receive-cd-set-of-plans");
  });
});

describe("progress", () => {
  it("starts at the first phase, nothing done", () => {
    expect(preconProgress(emptyPreconState())).toEqual({ done: 0, total: 27, blocked: 0, phase: "Design Development" });
    expect(preconStarted(emptyPreconState())).toBe(false);
  });
  it("moves to the first phase with a step left, counts blocked, skips N/A and hidden", () => {
    const dd = PRECON_TEMPLATE[0].steps.map((s) => ({ op: "status" as const, key: s.key, status: "done" as const }));
    const s = apply(
      emptyPreconState(),
      ...dd,
      { op: "status", key: key(1, 0), status: "done" },
      { op: "status", key: key(1, 1), status: "blocked" },
      { op: "status", key: key(1, 2), status: "na" },
      { op: "hide", key: key(1, 3), hidden: true },
    );
    expect(preconProgress(s)).toEqual({ done: 8, total: 25, blocked: 1, phase: "Permit Set" });
    expect(preconStarted(s)).toBe(true);
  });
  it("reads Done when every counted step is", () => {
    const all = PRECON_TEMPLATE.flatMap((p) => p.steps.map((x) => ({ op: "status" as const, key: x.key, status: "done" as const })));
    expect(preconProgress(apply(emptyPreconState(), ...all)).phase).toBe("Done");
  });
});

describe("ops", () => {
  it("sets a status with who and when, and keeps the note", () => {
    const s = apply(emptyPreconState(), { op: "note", key: key(0, 1), text: "Waiting on tile and drywall" }, { op: "status", key: key(0, 1), status: "progress" });
    expect(s.steps[key(0, 1)]).toEqual({ status: "progress", note: "Waiting on tile and drywall", by: "ty@ascentbuildingco.com", at: AT });
  });
  it("ignores a key the job does not have", () => {
    const s = emptyPreconState();
    expect(apply(s, { op: "status", key: "dd.nope", status: "done" })).toBe(s);
  });
  it("adds a step to a phase, lists it after the template's, and removes it", () => {
    let s = apply(emptyPreconState(), { op: "add", phase: "permit", text: "Geotech report", key: "c-abc123" });
    const permit = preconRows(s)[1];
    expect(permit.rows.at(-1)).toMatchObject({ key: "c-abc123", text: "Geotech report", custom: true });
    expect(preconProgress(s).total).toBe(28);
    s = apply(s, { op: "status", key: "c-abc123", status: "done" }, { op: "remove", key: "c-abc123" });
    expect(s.custom).toEqual([]);
    expect(s.steps["c-abc123"]).toBeUndefined();
  });
  it("hides a template step instead of removing it", () => {
    const s = emptyPreconState();
    expect(apply(s, { op: "remove", key: key(0, 0) })).toBe(s);
    expect(apply(s, { op: "hide", key: key(0, 0), hidden: true }).hidden).toEqual([key(0, 0)]);
  });
  it("keeps open questions", () => {
    expect(apply(emptyPreconState(), { op: "questions", text: "Laydown area?" }).questions).toBe("Laydown area?");
  });
});

describe("input checks", () => {
  it("accepts good ops and refuses bad ones", () => {
    expect(asPreconOp({ op: "status", key: key(0, 0), status: "blocked" })).toEqual({ op: "status", key: key(0, 0), status: "blocked" });
    expect(asPreconOp({ op: "status", key: key(0, 0), status: "maybe" })).toBeNull();
    expect(asPreconOp({ op: "add", phase: "nowhere", text: "x", key: "c-1" })).toBeNull();
    expect(asPreconOp({ op: "add", phase: "dd", text: "x", key: "dd.x" })).toBeNull();
    expect(asPreconOp({ op: "add", phase: "dd", text: "  x ", key: "c-1" })).toEqual({ op: "add", phase: "dd", text: "x", key: "c-1" });
    expect(asPreconOp({ op: "note", key: "", text: "x" })).toBeNull();
    expect(asPreconOp(null)).toBeNull();
  });
  it("reads a stored value back, and junk as empty", () => {
    const s = apply(emptyPreconState(), { op: "status", key: key(0, 0), status: "done" });
    expect(asPreconState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(asPreconState("junk")).toEqual(emptyPreconState());
    expect(asPreconState({ steps: { a: { status: "weird" } } }).steps.a.status).toBe("todo");
  });
});
