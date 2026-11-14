import { describe, expect, it } from "vitest";

import { RETRY_GAP_MS, classify, dueSaves, isExpired, parseOutbox, upsertSave, type PendingSave } from "./mileageOutbox";

const NOW = Date.parse("2026-11-14T18:00:00.000Z");
const save = (key: string, over: Partial<PendingSave> = {}): PendingSave => ({
  key,
  body: { clientKey: key, miles: 4 },
  queuedAt: "2026-11-14T17:00:00.000Z",
  lastTryAt: "",
  tries: 0,
  ...over,
});

describe("parseOutbox", () => {
  it("keeps good entries and skips bad ones", () => {
    const list = parseOutbox([save("a"), { key: "", body: {} }, { key: "b" }, null, "x"]);
    expect(list.map((e) => e.key)).toEqual(["a"]);
  });
  it("reads a non-list as empty", () => {
    expect(parseOutbox({ key: "a" })).toEqual([]);
  });
});

describe("upsertSave", () => {
  it("replaces the save with the same key", () => {
    const next = upsertSave([save("a"), save("b")], save("a", { body: { miles: 9 } }));
    expect(next.map((e) => e.key)).toEqual(["b", "a"]);
    expect(next[1].body).toEqual({ miles: 9 });
  });
});

describe("dueSaves", () => {
  it("sends a save never tried", () => {
    expect(dueSaves([save("a")], NOW)).toHaveLength(1);
  });
  it("waits on a send that may still be in flight", () => {
    const recent = new Date(NOW - RETRY_GAP_MS + 1000).toISOString();
    const old = new Date(NOW - RETRY_GAP_MS - 1000).toISOString();
    expect(dueSaves([save("a", { lastTryAt: recent }), save("b", { lastTryAt: old })], NOW).map((e) => e.key)).toEqual(["b"]);
  });
  it("skips an expired save", () => {
    const e = save("a", { queuedAt: "2026-10-01T00:00:00.000Z" });
    expect(isExpired(e, NOW)).toBe(true);
    expect(dueSaves([e], NOW)).toEqual([]);
  });
});

describe("classify", () => {
  it("is ok only for a 2xx the script did not refuse", () => {
    expect(classify(200, { ok: true })).toBe("ok");
    expect(classify(200, { ok: false, error: "lock" })).toBe("retry");
  });
  it("drops only a request the route rejects as bad", () => {
    expect(classify(400, { error: "bad" })).toBe("drop");
    expect(classify(413, {})).toBe("drop");
  });
  it("keeps the save on sign-out, a send in flight and server errors", () => {
    for (const s of [401, 409, 500, 502, 503, 504]) expect(classify(s, {})).toBe("retry");
  });
});
