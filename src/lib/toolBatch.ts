import { revalidateTag } from "next/cache";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { toolBatchEvents, toolBatchItems, toolBatchPhotos } from "@/db/schema";
import { callAppsScript } from "@/lib/appsScript";
import { mirrorToolWrite } from "@/lib/sheetTables";
import { getSheetTools, type SheetTool } from "@/lib/toolScheduleStore";
import { moveLoadWith } from "@/lib/toolTrailers";
import {
  STALE_RUN_MINUTES,
  analysisDue,
  mergeFields,
  type BatchPhotoRole,
  type BatchToolFields,
  type DueAnswer,
} from "@/lib/toolBatchRules";

/**
 * Batch add, server side (rules in lib/toolBatchRules.ts).
 *
 * The phone (src/app/tools/BatchAdd.tsx) writes captures through
 * /api/tools/batch. Claude Code — on the office Mac (scripts/tool-batch/) or in
 * a session started from a copied prompt — reads them through
 * /api/invoice-review/agent/tools, fills the details in, and posts each tool
 * back. `applyResult` then writes it to the Tools list:
 *
 *   mode "add"     Apps Script createTool + updateToolPhoto — the same two
 *                  writes the Tools page's "Add tool" makes.
 *   mode "update"  a tool already on the list (a known QR scanned in Batch
 *                  add, or "Ask Claude" in its Edit dialog): updateTool with
 *                  only the fields Claude filled, plus a new photo if one was
 *                  taken. A blank answer never clears a value.
 *
 * Each run holds its tools by `run_id`, so a run from a phone session and one
 * from the office Mac never close each other's tools.
 */

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Photos of a finished tool are kept this long, then dropped (Drive keeps the tool photo). */
const KEEP_PHOTOS_DAYS = 30;
/** A tool left in "capturing" this long (the phone closed mid-tool) counts as ready. */
const IDLE_CAPTURE_MINUTES = 60;
const TIMEOUT = { timeoutMs: 50_000 };
const OPEN = ["capturing", "ready", "analyzing"];

export async function saveItem(input: {
  id: string;
  toolId: string;
  idSource: string;
  mode: string;
  location: string;
  by: string;
}): Promise<void> {
  await ensureDb();
  const at = now();
  await db
    .insert(toolBatchItems)
    .values({
      id: input.id,
      toolId: input.toolId,
      idSource: input.idSource === "assigned" ? "assigned" : "qr",
      mode: input.mode === "update" ? "update" : "add",
      location: input.location,
      status: "capturing",
      createdBy: input.by,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing();
}

/** The phone's GPS fix arrived after these tools were started: give them the job site. */
export async function setLocation(ids: string[], location: string): Promise<void> {
  if (!ids.length || !location) return;
  await ensureDb();
  await db
    .update(toolBatchItems)
    .set({ location })
    .where(and(inArray(toolBatchItems.id, ids), eq(toolBatchItems.location, ""), inArray(toolBatchItems.status, ["capturing", "ready"])));
}

/**
 * Ask Claude to fill in tools already on the list, from their Drive photo.
 * A tool that is already waiting or being analyzed is not queued twice.
 * Returns how many were queued.
 */
export async function queueUpdates(toolIds: string[], by: string): Promise<number> {
  await ensureDb();
  const open = await db
    .select({ toolId: toolBatchItems.toolId })
    .from(toolBatchItems)
    .where(and(inArray(toolBatchItems.toolId, toolIds), inArray(toolBatchItems.status, OPEN)));
  const busy = new Set(open.map((o) => o.toolId));
  const at = now();
  const rows = toolIds
    .filter((t) => t && !busy.has(t))
    .map((toolId) => ({
      id: "u-" + randomId(),
      toolId,
      idSource: "existing",
      mode: "update",
      status: "ready",
      createdBy: by,
      createdAt: at,
      updatedAt: at,
    }));
  if (rows.length) await db.insert(toolBatchItems).values(rows);
  return rows.length;
}

/** False when the item does not exist. A repeated photo id is ignored (a retried upload). */
export async function savePhoto(input: {
  id: string;
  itemId: string;
  role: BatchPhotoRole;
  mime: string;
  bytes: Buffer;
}): Promise<boolean> {
  await ensureDb();
  const [item] = await db.select({ id: toolBatchItems.id }).from(toolBatchItems).where(eq(toolBatchItems.id, input.itemId));
  if (!item) return false;
  const at = now();
  await db
    .insert(toolBatchPhotos)
    .values({ id: input.id, itemId: input.itemId, role: input.role, mime: input.mime, bytes: input.bytes, createdAt: at })
    .onConflictDoNothing();
  await db.update(toolBatchItems).set({ updatedAt: at }).where(eq(toolBatchItems.id, input.itemId));
  return true;
}

/** The phone closed before any photo of this tool: drop it, unless it already moved on. */
export async function cancelCapture(itemId: string): Promise<void> {
  await ensureDb();
  const [item] = await db.select({ status: toolBatchItems.status }).from(toolBatchItems).where(eq(toolBatchItems.id, itemId));
  if (item?.status !== "capturing") return;
  await db.delete(toolBatchPhotos).where(eq(toolBatchPhotos.itemId, itemId));
  await db.delete(toolBatchItems).where(eq(toolBatchItems.id, itemId));
}

/** The phone is done with this tool: it may now be analyzed. */
export async function finishCapture(itemId: string): Promise<void> {
  await ensureDb();
  await db
    .update(toolBatchItems)
    .set({ status: "ready", updatedAt: now() })
    .where(and(eq(toolBatchItems.id, itemId), eq(toolBatchItems.status, "capturing")));
}

async function logEvent(kind: string, message: string, by: string): Promise<void> {
  await db.insert(toolBatchEvents).values({ kind, message: message.slice(0, 2000), by, at: now() });
}

export async function requestAnalysis(by: string): Promise<void> {
  await ensureDb();
  await logEvent("request", "Analyze Tools Batch", by);
}

async function recentEvents(limit = 30) {
  return db.select().from(toolBatchEvents).orderBy(desc(toolBatchEvents.id)).limit(limit);
}

async function waitingItems() {
  return db
    .select({ status: toolBatchItems.status, updatedAt: toolBatchItems.updatedAt })
    .from(toolBatchItems)
    .where(inArray(toolBatchItems.status, ["capturing", "ready"]));
}

/** Count tools left mid-capture long enough ago as ready (they have a tool photo). */
async function promoteIdleCaptures(): Promise<void> {
  await db
    .update(toolBatchItems)
    .set({ status: "ready" })
    .where(
      and(
        eq(toolBatchItems.status, "capturing"),
        lt(toolBatchItems.updatedAt, minutesAgo(IDLE_CAPTURE_MINUTES)),
        sql`EXISTS (SELECT 1 FROM tool_batch_photos p WHERE p.item_id = tool_batch_items.id AND p.role = 'tool')`,
      ),
    );
}

export async function dueNow(): Promise<DueAnswer> {
  await ensureDb();
  await promoteIdleCaptures();
  const [items, events] = await Promise.all([waitingItems(), recentEvents()]);
  return analysisDue({ now: Date.now(), items, events });
}

export interface BatchSummary {
  counts: Record<string, number>;
  waiting: { id: string; toolId: string; mode: string; status: string; createdBy: string; createdAt: string; photos: number }[];
  problems: { id: string; toolId: string; mode: string; error: string; updatedAt: string }[];
  recentlyAdded: { id: string; toolId: string; mode: string; name: string; updatedAt: string }[];
  events: { kind: string; message: string; by: string; at: string }[];
  due: DueAnswer;
}

/** What the Tools page shows in its batch card. */
export async function batchSummary(): Promise<BatchSummary> {
  await ensureDb();
  const due = await dueNow(); // promotes idle captures first, so the counts agree with it
  const rows = await db
    .select({ status: toolBatchItems.status, n: sql<number>`count(*)` })
    .from(toolBatchItems)
    .groupBy(toolBatchItems.status);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.n);
  const waiting = await db
    .select({
      id: toolBatchItems.id,
      toolId: toolBatchItems.toolId,
      mode: toolBatchItems.mode,
      status: toolBatchItems.status,
      createdBy: toolBatchItems.createdBy,
      createdAt: toolBatchItems.createdAt,
      photos: sql<number>`(SELECT count(*) FROM tool_batch_photos p WHERE p.item_id = tool_batch_items.id)`,
    })
    .from(toolBatchItems)
    .where(inArray(toolBatchItems.status, ["capturing", "ready"]))
    .orderBy(toolBatchItems.createdAt)
    .limit(300);
  const problems = await db
    .select({ id: toolBatchItems.id, toolId: toolBatchItems.toolId, mode: toolBatchItems.mode, error: toolBatchItems.error, updatedAt: toolBatchItems.updatedAt })
    .from(toolBatchItems)
    .where(eq(toolBatchItems.status, "error"))
    .orderBy(desc(toolBatchItems.updatedAt))
    .limit(50);
  const added = await db
    .select({ id: toolBatchItems.id, toolId: toolBatchItems.toolId, mode: toolBatchItems.mode, result: toolBatchItems.result, updatedAt: toolBatchItems.updatedAt })
    .from(toolBatchItems)
    .where(and(eq(toolBatchItems.status, "added"), sql`${toolBatchItems.updatedAt} > ${minutesAgo(7 * 24 * 60)}`))
    .orderBy(desc(toolBatchItems.updatedAt))
    .limit(50);
  const recentlyAdded = added.map((a) => {
    let name = "";
    try {
      name = String((JSON.parse(a.result) as { name?: string }).name ?? "");
    } catch {
      /* no result text */
    }
    return { id: a.id, toolId: a.toolId, mode: a.mode, name, updatedAt: a.updatedAt };
  });
  const events = (await recentEvents(8)).map(({ kind, message, by, at }) => ({ kind, message, by, at }));
  return { counts, waiting: waiting.map((w) => ({ ...w, photos: Number(w.photos) })), problems, recentlyAdded, events, due };
}

/** Put an item that failed back in the queue, or drop it and its photos. */
export async function retryItem(id: string): Promise<void> {
  await ensureDb();
  await db
    .update(toolBatchItems)
    .set({ status: "ready", error: "", runId: "", updatedAt: now() })
    .where(and(eq(toolBatchItems.id, id), eq(toolBatchItems.status, "error")));
}

export async function discardItem(id: string): Promise<void> {
  await ensureDb();
  const [item] = await db.select({ status: toolBatchItems.status }).from(toolBatchItems).where(eq(toolBatchItems.id, id));
  if (!item || !["error", "ready"].includes(item.status)) return;
  await db.delete(toolBatchPhotos).where(eq(toolBatchPhotos.itemId, id));
  await db.delete(toolBatchItems).where(eq(toolBatchItems.id, id));
}

export interface RunItem {
  id: string;
  toolId: string;
  idSource: string;
  mode: string;
  location: string;
  createdBy: string;
  createdAt: string;
  photos: { id: string; role: string; createdAt: string }[];
  /** mode "update": the tool as the Tools list has it now, and whether it has a Drive photo. */
  current: (BatchToolFields & { location: string; hasDrivePhoto: boolean }) | null;
}

export interface RunStart {
  runId: string;
  items: RunItem[];
  catalog: {
    types: string[];
    toolGroups: string[];
    conditions: string[];
    tools: { id: string; name: string; type: string; toolGroup: string }[];
  };
}

const distinct = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean))).sort();

const currentOf = (t: SheetTool | undefined): RunItem["current"] =>
  t
    ? {
        name: t.name,
        type: t.type,
        toolGroup: t.toolGroup,
        serial: t.serial,
        accessories: t.accessories,
        condition: t.condition,
        location: t.locationLabel || t.location,
        hasDrivePhoto: !!t.photoUrl,
      }
    : null;

/**
 * Start a run: the ready tools (all of them, or only `onlyIds`) move to
 * "analyzing" under a new run id and are handed out with their photo ids, plus
 * the catalog's own words so Claude names tools the same way. A run that died
 * (analyzing longer than STALE_RUN_MINUTES) gives its tools back first.
 */
export async function beginRun(by: string, onlyIds: string[] = []): Promise<RunStart> {
  await ensureDb();
  await promoteIdleCaptures();
  await db
    .update(toolBatchItems)
    .set({ status: "ready", runId: "" })
    .where(and(eq(toolBatchItems.status, "analyzing"), lt(toolBatchItems.updatedAt, minutesAgo(STALE_RUN_MINUTES))));
  const runId = randomId();
  const where = onlyIds.length
    ? and(eq(toolBatchItems.status, "ready"), inArray(toolBatchItems.id, onlyIds))
    : eq(toolBatchItems.status, "ready");
  const ready = await db.select().from(toolBatchItems).where(where).orderBy(toolBatchItems.createdAt);
  const ids = ready.map((r) => r.id);
  if (ids.length) {
    await db.update(toolBatchItems).set({ status: "analyzing", runId, updatedAt: now() }).where(inArray(toolBatchItems.id, ids));
  }
  const photos = ids.length
    ? await db
        .select({ id: toolBatchPhotos.id, itemId: toolBatchPhotos.itemId, role: toolBatchPhotos.role, createdAt: toolBatchPhotos.createdAt })
        .from(toolBatchPhotos)
        .where(inArray(toolBatchPhotos.itemId, ids))
        .orderBy(toolBatchPhotos.createdAt)
    : [];
  await logEvent("started", `${ids.length} tool(s) handed to Claude Code${onlyIds.length ? " (picked from the Tools page)" : ""}`, by);

  const sheet = await getSheetTools().catch(() => [] as SheetTool[]);
  const byId = new Map(sheet.map((t) => [t.id.toLowerCase(), t]));
  return {
    runId,
    items: ready.map((r) => ({
      id: r.id,
      toolId: r.toolId,
      idSource: r.idSource,
      mode: r.mode,
      location: r.location,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      photos: photos.filter((p) => p.itemId === r.id).map(({ id, role, createdAt }) => ({ id, role, createdAt })),
      current: r.mode === "update" ? currentOf(byId.get(r.toolId.toLowerCase())) : null,
    })),
    catalog: {
      types: distinct(sheet.map((t) => t.type)),
      toolGroups: distinct(sheet.map((t) => t.toolGroup)),
      conditions: distinct(sheet.map((t) => t.condition)),
      tools: sheet.map(({ id, name, type, toolGroup }) => ({ id, name, type, toolGroup })),
    },
  };
}

export async function readPhoto(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  await ensureDb();
  const [p] = await db.select({ mime: toolBatchPhotos.mime, bytes: toolBatchPhotos.bytes }).from(toolBatchPhotos).where(eq(toolBatchPhotos.id, id));
  return p ? { mime: p.mime, bytes: Buffer.from(p.bytes) } : null;
}

/**
 * A listed tool's current photo, from its Drive thumbnail link at 1600 px. Null
 * when the tool has none or Drive refuses (the file is not link-shared).
 */
export async function readToolPhoto(toolId: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const sheet = await getSheetTools().catch(() => [] as SheetTool[]);
  const t = sheet.find((x) => x.id.toLowerCase() === toolId.toLowerCase());
  if (!t?.photoUrl) return null;
  const url = /[?&]sz=w\d+/.test(t.photoUrl) ? t.photoUrl.replace(/([?&]sz=)w\d+/, "$1w1600") : t.photoUrl;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const mime = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!res.ok || !mime.startsWith("image/")) return null;
    return { mime, bytes: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

async function markItem(id: string, status: "added" | "error", fields: { result?: string; error?: string }) {
  await db
    .update(toolBatchItems)
    .set({ status, result: fields.result ?? "", error: fields.error ?? "", updatedAt: now() })
    .where(eq(toolBatchItems.id, id));
}

async function uploadPhoto(itemId: string, toolId: string): Promise<string | undefined> {
  const [photo] = await db
    .select({ mime: toolBatchPhotos.mime, bytes: toolBatchPhotos.bytes })
    .from(toolBatchPhotos)
    .where(and(eq(toolBatchPhotos.itemId, itemId), eq(toolBatchPhotos.role, "tool")))
    .limit(1);
  if (!photo) return undefined;
  const b64 = Buffer.from(photo.bytes).toString("base64");
  const up = await callAppsScript(
    { action: "updateToolPhoto", toolId, imageBase64: `data:${photo.mime};base64,${b64}`, mimeType: photo.mime },
    TIMEOUT,
  );
  if (up.error) return `its photo did not upload: ${up.error}`;
  revalidateTag("tools");
  await mirrorToolWrite(up.data);
  return undefined;
}

export type ApplyOutcome = { ok: true; toolId: string; changed: string[]; warn?: string } | { ok: false; error: string };

/**
 * Write one analyzed tool to the Tools list. Mode "add" creates the row with
 * Claude's fields and the GPS job site, then uploads its tool photo. Mode
 * "update" writes only the fields Claude filled that differ from the list,
 * the GPS job site when the phone gave one, and a new photo when one was taken.
 * A photo failure is recorded, but the tool still counts as done.
 */
export async function applyResult(itemId: string, fields: BatchToolFields, note: string, by: string): Promise<ApplyOutcome> {
  await ensureDb();
  const [item] = await db.select().from(toolBatchItems).where(eq(toolBatchItems.id, itemId));
  if (!item) return { ok: false, error: "No such batch item." };
  if (item.status !== "analyzing") return { ok: false, error: `Item is ${item.status}, not analyzing.` };
  const result = JSON.stringify({ ...fields, note });

  const fail = async (error: string) => {
    await markItem(itemId, "error", { result, error });
    return { ok: false as const, error };
  };

  const sheet = await getSheetTools().catch(() => null);
  const listed = sheet?.find((t) => t.id.toLowerCase() === item.toolId.toLowerCase());

  if (item.mode === "update") {
    if (sheet && !listed) return fail(`"${item.toolId}" is no longer on the Tools list.`);
    const changes: Record<string, string> = mergeFields(currentOf(listed) ?? {}, fields);
    if (item.location && item.location !== listed?.location) changes.location = item.location;
    const changed = Object.keys(changes);
    if (changed.length) {
      const up = await callAppsScript({ action: "updateTool", toolId: item.toolId, fields: changes }, TIMEOUT);
      if (up.error) return fail(`Could not update the tool: ${up.error}`);
      revalidateTag("tools");
      await mirrorToolWrite(up.data, item.toolId);
      if (changes.location) await moveLoadWith(item.toolId, changes.location, by).catch(() => undefined);
    }
    const photoWarn = await uploadPhoto(itemId, item.toolId);
    const warn = photoWarn ? `Tool updated, but ${photoWarn}` : undefined;
    await markItem(itemId, "added", { result: JSON.stringify({ ...fields, note, changed }), error: warn ?? "" });
    return { ok: true, toolId: item.toolId, changed, warn };
  }

  if (!fields.name) return fail("A new tool needs a name.");
  if (listed) return fail(`A tool with ID "${item.toolId}" is already on the Tools list.`);
  const created = await callAppsScript(
    { action: "createTool", toolId: item.toolId, fields: { ...fields, location: item.location }, lastScanEmail: item.createdBy },
    TIMEOUT,
  );
  if (created.error) return fail(`Could not add the tool: ${created.error}`);
  revalidateTag("tools");
  await mirrorToolWrite(created.data);
  const photoWarn = await uploadPhoto(itemId, item.toolId);
  const warn = photoWarn ? `Tool added, but ${photoWarn}` : undefined;
  await markItem(itemId, "added", { result, error: warn ?? "" });
  return { ok: true, toolId: item.toolId, changed: Object.keys(fields), warn };
}

/** Claude could not fill this tool in (blurred photos, not a tool): park it for the office. */
export async function skipItem(itemId: string, reason: string): Promise<void> {
  await ensureDb();
  await db
    .update(toolBatchItems)
    .set({ status: "error", error: (reason || "Claude Code could not identify this tool.").slice(0, 1000), updatedAt: now() })
    .where(and(eq(toolBatchItems.id, itemId), eq(toolBatchItems.status, "analyzing")));
}

/**
 * The run is over. A failed run hands its tools back to the queue. A finished
 * run parks any tool it did not report on as a problem, so the timer does not
 * pick the same tool up again and again. Only this run's tools are touched
 * (all analyzing tools when no run id is given). Then log it and prune photos.
 */
export async function endRun(kind: "done" | "error", message: string, by: string, runId = ""): Promise<number> {
  await ensureDb();
  const mine = runId
    ? and(eq(toolBatchItems.status, "analyzing"), eq(toolBatchItems.runId, runId))
    : eq(toolBatchItems.status, "analyzing");
  const back = await db
    .update(toolBatchItems)
    .set(
      kind === "error"
        ? { status: "ready", runId: "", updatedAt: now() }
        : { status: "error", error: "The run ended without a result for this tool.", updatedAt: now() },
    )
    .where(mine)
    .returning({ id: toolBatchItems.id });
  await logEvent(kind, message || (kind === "done" ? "Run finished." : "Run failed."), by);
  const cutoff = minutesAgo(KEEP_PHOTOS_DAYS * 24 * 60);
  await db
    .delete(toolBatchPhotos)
    .where(
      inArray(
        toolBatchPhotos.itemId,
        db
          .select({ id: toolBatchItems.id })
          .from(toolBatchItems)
          .where(and(eq(toolBatchItems.status, "added"), lt(toolBatchItems.updatedAt, cutoff))),
      ),
    );
  return back.length;
}
