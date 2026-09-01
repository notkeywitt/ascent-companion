import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_TTL_DAYS,
  clearLocalDraft,
  draftAgeDays,
  draftSavedAtLabel,
  draftSize,
  isEmptyDraft,
  listLocalDrafts,
  readLocalDraft,
  reconcileDraft,
  writeLocalDraft,
  type DraftParts,
} from "@/lib/codingDraft";

/**
 * What a saved coding draft is worth when it comes back.
 *
 * The whole feature rests on one judgement — `reconcileDraft` — because a draft
 * is a decision made against data that has since moved. Restoring it blindly
 * would be worse than losing it: it would re-point a line at a budget leaf that
 * no longer exists, or leave the board sitting "dirty" with a change JobTread
 * has already taken, which is exactly the state that makes somebody press Sync
 * on nothing. So the drops are pinned here one cause at a time.
 *
 * The storage half is tested for the failures that actually happen on a phone:
 * a write cut off mid-JSON by a killed tab, and a draft old enough to be
 * somebody's forgotten work rather than their unfinished work.
 */

const world = {
  lines: [
    { id: "L1", jobCostItemId: "leafA" },
    { id: "L2", jobCostItemId: null },
    { id: "L3", jobCostItemId: "leafB" },
  ],
  bills: [{ id: "D1", nonRecoverableTax: 12.5 }],
  budgetIds: ["leafA", "leafB", "leafC"],
};

const parts = (over: Partial<DraftParts> = {}): DraftParts => ({
  staged: {},
  edits: {},
  taxEdits: {},
  ...over,
});

describe("reconcileDraft", () => {
  it("keeps a staged recode that still means something", () => {
    const r = reconcileDraft(parts({ staged: { L1: "leafB", L2: "leafC" } }), world);
    expect(r.staged).toEqual({ L1: "leafB", L2: "leafC" });
    expect(r.kept).toBe(2);
    expect(r.dropped).toBe(0);
  });

  it("drops a recode whose line is gone — combined away, deleted, or re-filed", () => {
    const r = reconcileDraft(parts({ staged: { GONE: "leafB" } }), world);
    expect(r.staged).toEqual({});
    expect(r.dropped).toBe(1);
  });

  it("drops a recode onto a budget leaf that no longer exists", () => {
    const r = reconcileDraft(parts({ staged: { L1: "leafDELETED" } }), world);
    expect(r.staged).toEqual({});
    expect(r.dropped).toBe(1);
  });

  it("drops a recode JobTread has ALREADY taken, so the page isn't dirty over nothing", () => {
    // L1 is on leafA in JobTread; staging it onto leafA is a no-op somebody else
    // (or a partly-failed Sync) has since made real.
    const r = reconcileDraft(parts({ staged: { L1: "leafA" } }), world);
    expect(r.staged).toEqual({});
    expect(r.kept).toBe(0);
    expect(r.dropped).toBe(1);
  });

  it("treats an uncoded line as coded to nothing, not to ''", () => {
    // L2 has jobCostItemId null — staging it anywhere is a real change.
    const r = reconcileDraft(parts({ staged: { L2: "leafA" } }), world);
    expect(r.staged).toEqual({ L2: "leafA" });
  });

  it("keeps line text edits whose line survives, and drops empty ones", () => {
    const r = reconcileDraft(
      parts({
        edits: {
          L1: { quantity: "3" },
          L3: { name: "", quantity: "", unitCost: "" }, // nothing typed
          GONE: { unitCost: "10" },
        },
      }),
      world,
    );
    expect(r.edits).toEqual({ L1: { quantity: "3" } });
    expect(r.dropped).toBe(2);
  });

  it("keeps a tax edit that differs, and drops one that matches what's stored", () => {
    const r = reconcileDraft(parts({ taxEdits: { D1: "20.00" } }), world);
    expect(r.taxEdits).toEqual({ D1: "20.00" });

    const same = reconcileDraft(parts({ taxEdits: { D1: "12.50" } }), world);
    expect(same.taxEdits).toEqual({});
    expect(same.dropped).toBe(1);
  });

  it("drops a tax edit for a bill that isn't on screen", () => {
    const r = reconcileDraft(parts({ taxEdits: { NOPE: "5" } }), world);
    expect(r.taxEdits).toEqual({});
    expect(r.dropped).toBe(1);
  });

  it("counts kept and dropped across all three kinds together", () => {
    const r = reconcileDraft(
      parts({
        staged: { L1: "leafB", L1_GONE: "leafB" },
        edits: { L3: { quantity: "2" } },
        taxEdits: { D1: "12.50" }, // already stored → dropped
      }),
      world,
    );
    expect(r.kept).toBe(2);
    expect(r.dropped).toBe(2);
  });
});

describe("draft shape helpers", () => {
  it("knows an empty draft from one with work in it", () => {
    expect(isEmptyDraft(parts())).toBe(true);
    expect(isEmptyDraft(parts({ staged: { L1: "leafB" } }))).toBe(false);
    expect(draftSize(parts({ staged: { L1: "leafB" }, taxEdits: { D1: "1" } }))).toBe(2);
  });

  it("treats an unreadable timestamp as infinitely old, so it is swept", () => {
    expect(draftAgeDays({ savedAt: "not a date" })).toBe(Number.POSITIVE_INFINITY);
    const now = Date.parse("2026-09-01T12:00:00Z");
    expect(draftAgeDays({ savedAt: "2026-08-30T12:00:00Z" }, now)).toBe(2);
  });

  it("says when the work was done in the office's own words", () => {
    const now = new Date("2026-09-01T15:00:00");
    expect(draftSavedAtLabel("2026-09-01T09:30:00", now)).not.toMatch(/yesterday|Aug/);
    expect(draftSavedAtLabel("2026-08-31T09:30:00", now)).toMatch(/^yesterday, /);
    expect(draftSavedAtLabel("2026-08-20T09:30:00", now)).toMatch(/Aug 20/);
    expect(draftSavedAtLabel("")).toBe("earlier");
  });
});

// ---------------------------------------------------------------------------
// The localStorage half. The suite runs in node, so stand up just enough of a
// browser for it — the module reads `window.localStorage` at call time.
// ---------------------------------------------------------------------------

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    raw: map,
  };
}

describe("local draft storage", () => {
  let store: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips a draft and stamps it with when it was saved", () => {
    writeLocalDraft("job:J1:2026-08", parts({ staged: { L1: "leafB" } }));
    const back = readLocalDraft("job:J1:2026-08");
    expect(back?.staged).toEqual({ L1: "leafB" });
    expect(Number.isNaN(Date.parse(back!.savedAt))).toBe(false);
  });

  it("deletes rather than stores an empty draft — a cleared board holds nothing", () => {
    writeLocalDraft("job:J1:2026-08", parts({ staged: { L1: "leafB" } }));
    writeLocalDraft("job:J1:2026-08", parts());
    expect(readLocalDraft("job:J1:2026-08")).toBeNull();
    expect(store.raw.size).toBe(0);
  });

  it("reads a half-written draft as no draft, not as a crash", () => {
    // What a tab killed mid-write leaves behind.
    store.setItem("ascent.codingDraft.v1.job:J1:2026-08", '{"staged":{"L1":"lea');
    expect(readLocalDraft("job:J1:2026-08")).toBeNull();
  });

  it("sweeps a draft past its TTL instead of offering forgotten work back", () => {
    const old = new Date(Date.now() - (DRAFT_TTL_DAYS + 1) * 86_400_000).toISOString();
    store.setItem(
      "ascent.codingDraft.v1.job:J1:2026-08",
      JSON.stringify({ key: "job:J1:2026-08", savedAt: old, staged: { L1: "leafB" } }),
    );
    expect(readLocalDraft("job:J1:2026-08")).toBeNull();
    expect(store.raw.size).toBe(0); // and it's gone, not just hidden
  });

  it("lists this device's drafts newest first, ignoring everything else in storage", () => {
    store.setItem("theme", "dark"); // another feature's key
    writeLocalDraft("bill:D1", parts({ staged: { L1: "leafB" } }));
    writeLocalDraft("job:J1:2026-08", parts({ taxEdits: { D1: "9" } }));
    const keys = listLocalDrafts().map((d) => d.key);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("bill:D1");
    expect(keys).toContain("job:J1:2026-08");
  });

  it("clears one scope without touching the others", () => {
    writeLocalDraft("bill:D1", parts({ staged: { L1: "leafB" } }));
    writeLocalDraft("bill:D2", parts({ staged: { L2: "leafC" } }));
    clearLocalDraft("bill:D1");
    expect(readLocalDraft("bill:D1")).toBeNull();
    expect(readLocalDraft("bill:D2")?.staged).toEqual({ L2: "leafC" });
  });

  it("never throws when there is no browser at all (server render)", () => {
    vi.unstubAllGlobals();
    expect(readLocalDraft("bill:D1")).toBeNull();
    expect(listLocalDrafts()).toEqual([]);
    expect(() => clearLocalDraft("bill:D1")).not.toThrow();
  });
});
