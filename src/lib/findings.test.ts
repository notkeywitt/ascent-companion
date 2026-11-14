import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/** The store against a real throwaway libSQL file. */
beforeAll(() => {
  process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "findings-")), "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
});

describe("findings store", () => {
  it("resolves what a source stops reporting, and reopens it with its history", async () => {
    const f = await import("./findings");
    const a = { key: "a", title: "A is wrong", severity: "error" as const };
    const b = { key: "b", title: "B is wrong" };

    await f.report("src", [a, b], "", "2026-01-01T00:00:00.000Z");
    expect((await f.list({ source: "src" })).map((r) => r.key)).toEqual(["a", "b"]);

    // Another scope of the same source is a separate report.
    await f.report("src", [b], "2026-02", "2026-01-01T12:00:00.000Z");

    await f.report("src", [b], "", "2026-01-02T00:00:00.000Z");
    expect((await f.list({ source: "src", scope: "" })).map((r) => r.key)).toEqual(["b"]);
    expect(await f.list({ source: "src", scope: "2026-02" })).toHaveLength(1);

    await f.report("src", [a, b], "", "2026-01-03T00:00:00.000Z");
    const back = (await f.list({ source: "src", scope: "" })).find((r) => r.key === "a")!;
    expect(back.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(back.resolvedAt).toBe("");
  });

  it("hides a snoozed or dismissed row, and keeps a dismissal across reports", async () => {
    const f = await import("./findings");
    await f.report("hide", [{ key: "x", title: "X" }, { key: "y", title: "Y" }]);
    const [x, y] = await f.list({ source: "hide" });

    await f.snooze(x.id, "2999-01-01T00:00:00.000Z");
    await f.dismiss(y.id, "a@x.com", "known");
    expect(await f.list({ source: "hide" })).toHaveLength(0);
    expect(await f.list({ source: "hide", hidden: true })).toHaveLength(2);

    await f.report("hide", [{ key: "x", title: "X" }, { key: "y", title: "Y" }]);
    expect(await f.list({ source: "hide" })).toHaveLength(0);

    // A source that owns its dismissals sets and clears them through report.
    await f.report("hide", [{ key: "x", title: "X" }, { key: "y", title: "Y", dismissed: null }]);
    expect((await f.list({ source: "hide" })).map((r) => r.key)).toEqual(["y"]);

    await f.restore(x.id);
    expect(await f.list({ source: "hide" })).toHaveLength(2);
  });

  it("shows a per-user row to its reader only", async () => {
    const f = await import("./findings");
    await f.report("mine", [{ key: "k", title: "Yours" }], "a@x.com");
    expect(await f.list({ source: "mine", reader: "a@x.com" })).toHaveLength(1);
    expect(await f.list({ source: "mine", reader: "b@x.com" })).toHaveLength(0);
  });

  it("dismisses and restores by identity, and keeps the dismissal through a report", async () => {
    const f = await import("./findings");
    await f.dismissByKey("dk", "chk", "chk::a", "a@x.com", "Old item");
    expect(await f.dismissedKeys("dk")).toEqual(new Set(["chk::a"]));
    expect(await f.list({ source: "dk", hidden: true })).toHaveLength(0); // resolved row

    await f.report("dk", [{ key: "chk::a", title: "Old item" }], "chk");
    expect(await f.list({ source: "dk" })).toHaveLength(0); // reopened, still dismissed
    expect(await f.list({ source: "dk", hidden: true })).toHaveLength(1);

    await f.restoreByKey("dk", "chk", "chk::a");
    expect((await f.dismissedKeys("dk")).size).toBe(0);
    expect(await f.list({ source: "dk" })).toHaveLength(1);
  });
});
