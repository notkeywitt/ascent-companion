import { describe, expect, it } from "vitest";

import {
  analysisDue,
  assignedToolId,
  batchPrompt,
  cleanFields,
  isAssignedId,
  mergeFields,
  toolIdFromQr,
} from "./toolBatchRules";

const T0 = Date.parse("2026-11-11T12:00:00Z");
const ago = (min: number) => new Date(T0 - min * 60_000).toISOString();

describe("assignedToolId", () => {
  it("makes a noqr- id from the readable alphabet", () => {
    const id = assignedToolId(() => 0);
    expect(id).toBe("noqr-22222");
    expect(isAssignedId(id)).toBe(true);
    expect(isAssignedId("tool087")).toBe(false);
    expect(assignedToolId(() => 0.9999)).toMatch(/^noqr-[2-9a-z]{5}$/);
  });
});

describe("toolIdFromQr", () => {
  it("reads a bare id or a ?tool= link", () => {
    expect(toolIdFromQr(" tool087 ")).toBe("tool087");
    expect(toolIdFromQr("https://x.app/tools?tool=tool012&y=1")).toBe("tool012");
  });
});

describe("analysisDue", () => {
  it("is not due with nothing ready", () => {
    expect(analysisDue({ now: T0, items: [{ status: "capturing", updatedAt: ago(90) }], events: [] }).due).toBe(false);
  });

  it("waits for captures to go quiet", () => {
    const a = analysisDue({ now: T0, items: [{ status: "ready", updatedAt: ago(5) }], events: [] });
    expect(a.due).toBe(false);
    const b = analysisDue({ now: T0, items: [{ status: "ready", updatedAt: ago(31) }], events: [] });
    expect(b).toMatchObject({ due: true, reason: "quiet", ready: 1 });
  });

  it("runs at once on a request made after the last run started", () => {
    const items = [{ status: "ready", updatedAt: ago(1) }];
    expect(analysisDue({ now: T0, items, events: [{ kind: "request", at: ago(0) }] }).reason).toBe("requested");
    const old = [
      { kind: "request", at: ago(60) },
      { kind: "started", at: ago(50) },
      { kind: "done", at: ago(40) },
    ];
    expect(analysisDue({ now: T0, items, events: old }).due).toBe(false);
  });

  it("does not start a second run while one is in progress, unless it went stale", () => {
    const items = [{ status: "ready", updatedAt: ago(200) }];
    const running = [{ kind: "started", at: ago(10) }, { kind: "request", at: ago(1) }];
    expect(analysisDue({ now: T0, items, events: running }).due).toBe(false);
    const stale = [{ kind: "started", at: ago(130) }];
    expect(analysisDue({ now: T0, items, events: stale }).due).toBe(true);
  });

  it("holds the timer after a failed run, but not a new request", () => {
    const items = [{ status: "ready", updatedAt: ago(60) }];
    const failed = [{ kind: "started", at: ago(50) }, { kind: "error", at: ago(45) }];
    expect(analysisDue({ now: T0, items, events: failed }).due).toBe(false);
    expect(analysisDue({ now: T0, items, events: [...failed, { kind: "request", at: ago(1) }] }).due).toBe(true);
  });
});

describe("cleanFields", () => {
  it("trims and refuses an empty result", () => {
    expect(cleanFields({ name: "  DeWalt   drill ", serial: 123 })).toMatchObject({ name: "DeWalt drill", serial: "123", type: "" });
    expect(cleanFields({ serial: "X1" })).toMatchObject({ name: "", serial: "X1" });
    expect(cleanFields({ name: "  " })).toBeNull();
  });
});

describe("mergeFields", () => {
  const blank = { name: "", type: "", toolGroup: "", serial: "", accessories: "", condition: "" };
  it("writes only filled, different values", () => {
    expect(
      mergeFields({ name: "Drill", serial: "AB1", type: "drill" }, { ...blank, name: "DeWalt DCD791 Drill", serial: "ab1", type: "Drill", condition: "Good" }),
    ).toEqual({ name: "DeWalt DCD791 Drill", condition: "Good" });
  });
});

describe("batchPrompt", () => {
  it("names the items and the begin command", () => {
    const p = batchPrompt(["a1", "b2"], ["tool001"]);
    expect(p.startsWith("/tool-batch")).toBe(true);
    expect(p).toContain("agent.mjs begin a1 b2");
    expect(batchPrompt([])).toContain("All tools waiting");
  });
});
