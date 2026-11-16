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

  it("counts kinds once, merging old invoice-review history", async () => {
    const f = await import("./findings");
    const { rawDb } = await import("@/db");
    await f.report("stats-src", [{ key: "a", title: "A", kind: "k" }, { key: "b", title: "B", kind: "k" }, { key: "c", title: "C", kind: "k" }]);
    await new Promise((r) => setTimeout(r, 5)); // resolve compares timestamps
    await f.report("stats-src", [{ key: "a", title: "A", kind: "k" }, { key: "b", title: "B", kind: "k" }]); // c resolves
    const rows = await f.list({ source: "stats-src" });
    await f.dismiss(rows.find((r) => r.key === "a")!.id, "x@y.z");
    const old = "2026-01-01T00:00:00.000Z";
    const ins = (ym: string, key: string, sup: number, res: string) =>
      rawDb().execute({
        sql: "INSERT INTO invoice_review_finding_state (ym, key, kind, first_seen_at, last_seen_at, resolved_at, was_suppressed) VALUES (?,?,?,?,?,?,?)",
        args: [ym, key, "dup", new Date().toISOString(), old, res, sup],
      });
    await f.report("invoice-review", [{ key: "m", title: "M", kind: "dup" }], "2999-10");
    await ins("2999-10", "m", 0, ""); // already in findings: not counted twice
    await ins("2026-05", "n", 0, old); // old, resolved
    await ins("2026-05", "o", 1, ""); // old, set aside
    const stats = await f.findingKindStats();
    expect(stats.find((s) => s.source === "stats-src")).toMatchObject({ seen: 3, open: 1, selfResolved: 1, dismissed: 1, snoozed: 0 });
    expect(stats.find((s) => s.source === "invoice-review")).toMatchObject({ seen: 3, open: 1, selfResolved: 1, dismissed: 1 });
  });

  it("leaves kept kinds and subjects open when a read failed", async () => {
    const f = await import("./findings");
    const rows = [
      { key: "mail", title: "M", kind: "email-bill-missed", subject: "j1" },
      { key: "bill", title: "B", kind: "bill-uninvoiced", subject: "j2" },
      { key: "other", title: "O", kind: "bill-uninvoiced", subject: "j3" },
    ];
    await f.report("keep", rows, "2999-01", "2026-01-01T00:00:00.000Z");
    // The mailbox and job j2 could not be read: only j3's row may resolve.
    await f.report("keep", [], "2999-01", "2026-01-02T00:00:00.000Z", {
      kinds: ["email-bill-missed"],
      subjects: ["j2"],
    });
    expect((await f.list({ source: "keep" })).map((r) => r.key).sort()).toEqual(["bill", "mail"]);
  });

  it("hides a closed month's rows without resolving them", async () => {
    const f = await import("./findings");
    await f.report("invoice-review", [{ key: "old", title: "Old", kind: "closed-k" }], "2000-01");
    await f.report("pre-send", [{ key: "old", title: "Old", kind: "closed-k" }], "2000-01:job1");
    await f.report("other-src", [{ key: "old", title: "Old", kind: "closed-k" }], "2000-01");
    expect(await f.list({ source: "invoice-review", scope: "2000-01" })).toHaveLength(0);
    expect(await f.list({ source: "pre-send" })).toHaveLength(0);
    expect(await f.list({ source: "other-src" })).toHaveLength(1); // not a billing-month source
    const k = (await f.findingKindStats()).filter((s) => s.kind === "closed-k");
    expect(k.find((s) => s.source === "invoice-review")).toMatchObject({ seen: 1, open: 0, selfResolved: 0, closed: 1 });
    expect(k.find((s) => s.source === "other-src")).toMatchObject({ open: 1, closed: 0 });
  });
});
