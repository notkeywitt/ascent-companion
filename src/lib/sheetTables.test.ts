import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const callAppsScriptOrThrow = vi.fn();
vi.mock("@/lib/appsScript", () => ({ callAppsScriptOrThrow: (...a: unknown[]) => callAppsScriptOrThrow(...a) }));

import { db, ensureDb } from "@/db";
import { mileageTrips, tools } from "@/db/schema";
import { compareTools, diffRows, mirrorMileageWrite, mirrorToolWrite, syncMileage, syncTools } from "./sheetTables";

const drill = { id: "T-1", name: "Drill", type: "Power", location: "P1", locationLabel: "Smith - House", photoUrl: "x" };
const trip = (id: string, key: string, miles: string) => ({ TripID: id, "Client Key": key, Date: "2026-11-03", Driver: "Sam", "Logged By": "Sam@x.com", Miles: miles });

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "stage7-")), "t.db")}`;
  await ensureDb();
});
afterEach(() => {
  delete process.env.COMPANION_TOOLS_DB_WRITES;
  delete process.env.COMPANION_MILEAGE_DB_WRITES;
  callAppsScriptOrThrow.mockReset();
});

describe("stage 7 copy — flags off", () => {
  it("writes nothing and calls nothing", async () => {
    await mirrorToolWrite({ ok: true, tool: drill });
    await mirrorMileageWrite("sam@x.com");
    expect(await db.select().from(tools)).toEqual([]);
    expect(callAppsScriptOrThrow).not.toHaveBeenCalled();
  });
});

describe("stage 7 copy — tools", () => {
  it("upserts an edit, follows a rename, removes a delete, skips ok:false", async () => {
    process.env.COMPANION_TOOLS_DB_WRITES = "true";
    await mirrorToolWrite({ ok: true, tool: drill }, "T-1");
    await mirrorToolWrite({ ok: true, tool: { ...drill, location: "P2" } }, "T-1");
    expect((await db.select().from(tools)).map((t) => [t.id, t.location])).toEqual([["T-1", "P2"]]);

    await mirrorToolWrite({ ok: true, tool: { ...drill, id: "T-9" } }, "T-1");
    await mirrorToolWrite({ ok: false, tool: { ...drill, id: "T-bad" } });
    expect((await db.select().from(tools)).map((t) => t.id)).toEqual(["T-9"]);

    await mirrorToolWrite({ ok: true, deleted: true, toolId: "T-9" }, "T-9");
    expect(await db.select().from(tools)).toEqual([]);
  });

  it("backfill replaces the table and the check then reads clean", async () => {
    await db.insert(tools).values({ id: "stale" });
    callAppsScriptOrThrow.mockResolvedValue({ ok: true, tools: [drill, { id: "T-2", name: "Saw" }] });
    expect(await syncTools()).toEqual({ rows: 2 });
    expect(await compareTools()).toMatchObject({ sheet: 2, db: 2, missingFromDb: [], notOnSheet: [], changed: [] });
  });
});

describe("stage 7 copy — mileage", () => {
  it("a driver's answer upserts; an admin's answer replaces", async () => {
    callAppsScriptOrThrow.mockResolvedValue({ ok: true, isAdmin: false, trips: [trip("MLG-1", "a", "5"), trip("MLG-1", "b", "7")] });
    await syncMileage("sam@x.com");
    callAppsScriptOrThrow.mockResolvedValue({ ok: true, isAdmin: false, trips: [trip("MLG-1", "a", "6")] });
    await syncMileage("sam@x.com");
    const rows = await db.select().from(mileageTrips);
    expect(rows.map((r) => [r.clientKey, r.miles, r.loggedBy]).sort()).toEqual([["a", 6, "sam@x.com"], ["b", 7, "sam@x.com"]]);
    expect(JSON.parse(rows.find((r) => r.clientKey === "a")!.row).Miles).toBe("6");

    callAppsScriptOrThrow.mockResolvedValue({ ok: true, isAdmin: true, trips: [trip("MLG-2", "c", "1")] });
    expect(await syncMileage("office@x.com")).toEqual({ rows: 1, full: true });
    expect((await db.select().from(mileageTrips)).map((r) => r.tripId)).toEqual(["MLG-2"]);
  });

  it("a failed copy is swallowed", async () => {
    process.env.COMPANION_MILEAGE_DB_WRITES = "true";
    callAppsScriptOrThrow.mockRejectedValue(new Error("sheet busy"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(mirrorMileageWrite("sam@x.com")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("diffRows", () => {
  it("names what is missing, extra and changed, ignoring updatedAt", () => {
    const r = (id: string, v: string, updatedAt = "") => ({ id, v, updatedAt });
    expect(diffRows([r("a", "1"), r("b", "2"), r("c", "3")], [r("a", "1", "later"), r("b", "x"), r("d", "4")], (x) => x.id)).toEqual({
      sheet: 3,
      db: 3,
      missingFromDb: ["c"],
      notOnSheet: ["d"],
      changed: ["b"],
    });
  });
});
