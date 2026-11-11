import { revalidateTag } from "next/cache";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { toolBatchEvents, toolBatchItems, toolBatchPhotos } from "@/db/schema";
import { callAppsScript } from "@/lib/appsScript";
import { mirrorToolWrite } from "@/lib/sheetTables";
import { getSheetTools } from "@/lib/toolScheduleStore";
import {
  STALE_RUN_MINUTES,
  analysisDue,
  type BatchPhotoRole,
  type BatchToolFields,
  type DueAnswer,
} from "@/lib/toolBatchRules";

/**
 * Batch add, server side (rules in lib/toolBatchRules.ts).
 *
 * The phone (src/app/tools/BatchAdd.tsx) writes captures through
 * /api/tools/batch. Claude Code on the office Mac (skill /tool-batch,
 * scripts/tool-batch/) reads them through /api/invoice-review/agent/tools,
 * fills the details in, and posts each tool back. `addTool` then registers it
 * on the Tools list (Apps Script createTool + updateToolPhoto), the same two
 * writes the Tools page's "Add tool" makes.
 */

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Photos of an added tool are kept this long, then dropped (Drive keeps the tool photo). */
const KEEP_PHOTOS_DAYS = 30;
/** A tool left in "capturing" this long (the phone closed mid-tool) counts as ready. */
const IDLE_CAPTURE_MINUTES = 60;
const TIMEOUT = { timeoutMs: 50_000 };

export async function saveItem(input: { id: string; toolId: string; idSource: string; by: string }): Promise<void> {
  await ensureDb();
  const at = now();
  await db
    .insert(toolBatchItems)
    .values({
      id: input.id,
      toolId: input.toolId,
      idSource: input.idSource === "assigned" ? "assigned" : "qr",
      status: "capturing",
      createdBy: input.by,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing();
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
  problems: { id: string; toolId: string; error: string; updatedAt: string }[];
  recentlyAdded: { id: string; toolId: string; name: string; updatedAt: string }[];
  events: { kind: string; message: string; by: string; at: string }[];
  due: DueAnswer;
}

/** What the Tools page shows in its batch card. */
export async function batchSummary(): Promise<BatchSummary> {
  await ensureDb();
  const rows = await db
    .select({ status: toolBatchItems.status, n: sql<number>`count(*)` })
    .from(toolBatchItems)
    .groupBy(toolBatchItems.status);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.n);
  const problems = await db
    .select({ id: toolBatchItems.id, toolId: toolBatchItems.toolId, error: toolBatchItems.error, updatedAt: toolBatchItems.updatedAt })
    .from(toolBatchItems)
    .where(eq(toolBatchItems.status, "error"))
    .orderBy(desc(toolBatchItems.updatedAt))
    .limit(50);
  const added = await db
    .select({ id: toolBatchItems.id, toolId: toolBatchItems.toolId, result: toolBatchItems.result, updatedAt: toolBatchItems.updatedAt })
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
    return { id: a.id, toolId: a.toolId, name, updatedAt: a.updatedAt };
  });
  const events = (await recentEvents(8)).map(({ kind, message, by, at }) => ({ kind, message, by, at }));
  return { counts, problems, recentlyAdded, events, due: await dueNow() };
}

/** Put an item that failed back in the queue, or drop it and its photos. */
export async function retryItem(id: string): Promise<void> {
  await ensureDb();
  await db
    .update(toolBatchItems)
    .set({ status: "ready", error: "", updatedAt: now() })
    .where(and(eq(toolBatchItems.id, id), eq(toolBatchItems.status, "error")));
}

export async function discardItem(id: string): Promise<void> {
  await ensureDb();
  const [item] = await db.select({ status: toolBatchItems.status }).from(toolBatchItems).where(eq(toolBatchItems.id, id));
  if (!item || item.status !== "error") return;
  await db.delete(toolBatchPhotos).where(eq(toolBatchPhotos.itemId, id));
  await db.delete(toolBatchItems).where(eq(toolBatchItems.id, id));
}

export interface RunItem {
  id: string;
  toolId: string;
  idSource: string;
  createdBy: string;
  createdAt: string;
  photos: { id: string; role: string; createdAt: string }[];
}

export interface RunStart {
  items: RunItem[];
  catalog: {
    types: string[];
    toolGroups: string[];
    conditions: string[];
    tools: { id: string; name: string; type: string; toolGroup: string }[];
  };
}

const distinct = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean))).sort();

/**
 * Start a run: every ready tool moves to "analyzing" and is handed out with its
 * photo ids, plus the catalog's own words so Claude names tools the same way.
 * A run that died (analyzing longer than STALE_RUN_MINUTES) gives its tools back.
 */
export async function beginRun(by: string): Promise<RunStart> {
  await ensureDb();
  await promoteIdleCaptures();
  await db
    .update(toolBatchItems)
    .set({ status: "ready" })
    .where(and(eq(toolBatchItems.status, "analyzing"), lt(toolBatchItems.updatedAt, minutesAgo(STALE_RUN_MINUTES))));
  const ready = await db.select().from(toolBatchItems).where(eq(toolBatchItems.status, "ready")).orderBy(toolBatchItems.createdAt);
  const ids = ready.map((r) => r.id);
  if (ids.length) {
    await db.update(toolBatchItems).set({ status: "analyzing", updatedAt: now() }).where(inArray(toolBatchItems.id, ids));
  }
  const photos = ids.length
    ? await db
        .select({ id: toolBatchPhotos.id, itemId: toolBatchPhotos.itemId, role: toolBatchPhotos.role, createdAt: toolBatchPhotos.createdAt })
        .from(toolBatchPhotos)
        .where(inArray(toolBatchPhotos.itemId, ids))
        .orderBy(toolBatchPhotos.createdAt)
    : [];
  await logEvent("started", `${ids.length} tool(s) handed to Claude Code`, by);

  const sheet = await getSheetTools().catch(() => []);
  return {
    items: ready.map((r) => ({
      id: r.id,
      toolId: r.toolId,
      idSource: r.idSource,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      photos: photos.filter((p) => p.itemId === r.id).map(({ id, role, createdAt }) => ({ id, role, createdAt })),
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

async function markItem(id: string, status: "added" | "error", fields: { result?: string; error?: string }) {
  await db
    .update(toolBatchItems)
    .set({ status, result: fields.result ?? "", error: fields.error ?? "", updatedAt: now() })
    .where(eq(toolBatchItems.id, id));
}

/**
 * Register one analyzed tool on the Tools list: create the row with Claude's
 * fields, then upload its tool photo. A photo failure is recorded but the tool
 * still counts as added — the row exists, and Edit can add the photo.
 */
export async function addTool(
  itemId: string,
  fields: BatchToolFields,
  note: string,
): Promise<{ ok: true; toolId: string; warn?: string } | { ok: false; error: string }> {
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
  if (sheet?.some((t) => t.id.toLowerCase() === item.toolId.toLowerCase())) {
    return fail(`A tool with ID "${item.toolId}" is already on the Tools list.`);
  }

  const created = await callAppsScript(
    { action: "createTool", toolId: item.toolId, fields: { ...fields, location: "" }, lastScanEmail: item.createdBy },
    TIMEOUT,
  );
  if (created.error) return fail(`Could not add the tool: ${created.error}`);
  revalidateTag("tools");
  await mirrorToolWrite(created.data);

  let warn: string | undefined;
  const [photo] = await db
    .select({ mime: toolBatchPhotos.mime, bytes: toolBatchPhotos.bytes })
    .from(toolBatchPhotos)
    .where(and(eq(toolBatchPhotos.itemId, itemId), eq(toolBatchPhotos.role, "tool")))
    .limit(1);
  if (photo) {
    const b64 = Buffer.from(photo.bytes).toString("base64");
    const up = await callAppsScript(
      { action: "updateToolPhoto", toolId: item.toolId, imageBase64: `data:${photo.mime};base64,${b64}`, mimeType: photo.mime },
      TIMEOUT,
    );
    if (up.error) warn = `Tool added, but its photo did not upload: ${up.error}`;
    else {
      revalidateTag("tools");
      await mirrorToolWrite(up.data);
    }
  }
  await markItem(itemId, "added", { result, error: warn ?? "" });
  return { ok: true, toolId: item.toolId, warn };
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
 * pick the same tool up again and again. Then log it and prune old photos.
 */
export async function endRun(kind: "done" | "error", message: string, by: string): Promise<number> {
  await ensureDb();
  const back = await db
    .update(toolBatchItems)
    .set(
      kind === "error"
        ? { status: "ready", updatedAt: now() }
        : { status: "error", error: "The run ended without a result for this tool.", updatedAt: now() },
    )
    .where(eq(toolBatchItems.status, "analyzing"))
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
