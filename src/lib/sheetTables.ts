import { eq, sql } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { mileageTrips, tools } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

/**
 * STAGE 7 — the Tools and Mileage tabs, copied into the companion DB.
 * Plan and flip steps: docs/plans/STAGE7_TOOLS_MILEAGE.md.
 *
 * The sheet is still the record. Every write still goes to Apps Script first,
 * exactly as before. With a flag on, the route ALSO copies the result here.
 * Nothing reads these tables yet. Both flags default off, and a failed copy is
 * logged and swallowed: it must never change what the route answers.
 */

const on = (name: string) => String(process.env[name] ?? "").trim().toLowerCase() === "true";
export const toolsDbWrites = () => on("COMPANION_TOOLS_DB_WRITES");
export const mileageDbWrites = () => on("COMPANION_MILEAGE_DB_WRITES");

type SheetRow = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();

/** An Apps Script tool object → a `tools` row. */
export function toolRow(t: SheetRow, now = new Date().toISOString()) {
  return {
    id: s(t.id),
    name: s(t.name),
    type: s(t.type),
    condition: s(t.condition),
    toolGroup: s(t.toolGroup),
    serial: s(t.serial),
    accessories: s(t.accessories),
    location: s(t.location),
    lastscan: s(t.lastscan),
    lastScanEmail: s(t.lastScanEmail),
    photoLink: s(t.photoLink),
    updatedAt: now,
  };
}

/** A `listMileage` trip ({header: value}) → a `mileage_trips` row. */
export function tripRow(t: SheetRow, now = new Date().toISOString()) {
  return {
    tripId: s(t["TripID"]),
    clientKey: s(t["Client Key"]),
    date: s(t["Date"]),
    driver: s(t["Driver"]),
    loggedBy: s(t["Logged By"]).toLowerCase(),
    miles: Number(t["Miles"]) || 0,
    row: JSON.stringify(t),
    updatedAt: now,
  };
}

/**
 * Copy one successful Apps Script tool write (create, edit, scan, photo,
 * delete) into `tools`. `sentId` is the ToolId the request named: a rename
 * answers with a different id and a delete with no tool, and both remove the
 * old row. Does nothing with the flag off. Never throws.
 */
export async function mirrorToolWrite(data: unknown, sentId = ""): Promise<void> {
  if (!toolsDbWrites()) return;
  try {
    const d = (data ?? {}) as { ok?: boolean; tool?: SheetRow; deleted?: boolean };
    if (d.ok === false) return;
    const row = d.tool ? toolRow(d.tool) : null;
    await ensureDb();
    if (sentId && (d.deleted || (row && row.id !== sentId))) {
      await db.delete(tools).where(eq(tools.id, sentId));
    }
    if (row?.id) await db.insert(tools).values(row).onConflictDoUpdate({ target: tools.id, set: row });
  } catch (e) {
    console.error("[stage7] tools DB write failed", e);
  }
}

/** Replace `tools` with the sheet's list. The backfill, and the repair for drift. */
export async function syncTools(): Promise<{ rows: number }> {
  const b = await callAppsScriptOrThrow<{ tools?: SheetRow[] }>({ action: "toolsBootstrap" }, { timeoutMs: 50_000 });
  const rows = (b.tools ?? []).map((t) => toolRow(t)).filter((r) => r.id);
  await ensureDb();
  await db.transaction(async (tx) => {
    await tx.delete(tools);
    for (let i = 0; i < rows.length; i += 500) await tx.insert(tools).values(rows.slice(i, i + 500));
  });
  return { rows: rows.length };
}

/**
 * Copy the trips `requesterEmail` may see from the sheet into `mileage_trips`.
 * An Apps Script mileage admin gets every trip, so that answer REPLACES the
 * table (the backfill); anyone else gets their own trips, which are upserted.
 * `logMileage` does not answer with the row it wrote, so this read is how a new
 * trip reaches the DB.
 */
export async function syncMileage(requesterEmail: string): Promise<{ rows: number; full: boolean }> {
  const r = await callAppsScriptOrThrow<{ isAdmin?: boolean; trips?: SheetRow[] }>(
    { action: "listMileage", requesterEmail, month: "", user: "" },
    { timeoutMs: 50_000 },
  );
  const rows = (r.trips ?? []).map((t) => tripRow(t)).filter((x) => x.tripId);
  const full = !!r.isAdmin;
  await ensureDb();
  await db.transaction(async (tx) => {
    if (full) await tx.delete(mileageTrips);
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(mileageTrips)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [mileageTrips.tripId, mileageTrips.clientKey],
          set: {
            date: sql`excluded.date`,
            driver: sql`excluded.driver`,
            loggedBy: sql`excluded.logged_by`,
            miles: sql`excluded.miles`,
            row: sql`excluded.row`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  });
  return { rows: rows.length, full };
}

/** After a successful mileage write. Does nothing with the flag off. Never throws. */
export async function mirrorMileageWrite(requesterEmail: string): Promise<void> {
  if (!mileageDbWrites()) return;
  try {
    await syncMileage(requesterEmail);
  } catch (e) {
    console.error("[stage7] mileage DB write failed", e);
  }
}

/**
 * Sheet rows against DB rows, by key. `changed` compares every field but
 * `updatedAt`. The flip test: all three lists are empty.
 */
export function diffRows<T extends { updatedAt: string }>(sheet: T[], dbRows: T[], key: (r: T) => string) {
  const body = (r: T) => JSON.stringify({ ...r, updatedAt: "" });
  const inDb = new Map(dbRows.map((r) => [key(r), body(r)]));
  const inSheet = new Set(sheet.map(key));
  return {
    sheet: sheet.length,
    db: dbRows.length,
    missingFromDb: sheet.filter((r) => !inDb.has(key(r))).map(key),
    notOnSheet: dbRows.filter((r) => !inSheet.has(key(r))).map(key),
    changed: sheet.filter((r) => inDb.has(key(r)) && inDb.get(key(r)) !== body(r)).map(key),
  };
}

/** The sheet's tools against `tools`. Reads only. */
export async function compareTools() {
  const b = await callAppsScriptOrThrow<{ tools?: SheetRow[] }>({ action: "toolsBootstrap" }, { timeoutMs: 50_000 });
  await ensureDb();
  return diffRows((b.tools ?? []).map((t) => toolRow(t)).filter((r) => r.id), await db.select().from(tools), (r) => r.id);
}

/** The sheet's trips against `mileage_trips`. Reads only. Needs a mileage admin's email. */
export async function compareMileage(requesterEmail: string) {
  const r = await callAppsScriptOrThrow<{ isAdmin?: boolean; trips?: SheetRow[] }>(
    { action: "listMileage", requesterEmail, month: "", user: "" },
    { timeoutMs: 50_000 },
  );
  if (!r.isAdmin) throw new Error("The Mileage sheet answered with one driver's trips. Sign in as a mileage admin.");
  await ensureDb();
  return diffRows(
    (r.trips ?? []).map((t) => tripRow(t)).filter((x) => x.tripId),
    await db.select().from(mileageTrips),
    (x) => `${x.tripId}|${x.clientKey}`,
  );
}
