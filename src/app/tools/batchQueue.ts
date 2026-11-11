"use client";

/**
 * Batch add's upload queue. The camera screen never waits on the network: each
 * step (a QR read, a photo, "no more pictures") is written to IndexedDB at once
 * and a background loop sends the steps in order. A dropped signal, a locked
 * phone or a closed tab only delays them; the Tools page resumes the queue on
 * its next visit. Steps go in order, so a tool's photos reach the server before
 * its "done".
 *
 * Server side: /api/tools/batch and /api/tools/batch/photo (lib/toolBatch.ts).
 */

export type BatchOp =
  | { kind: "item"; id: string; toolId: string; idSource: "qr" | "assigned"; mode?: "add" | "update"; location?: string }
  | { kind: "location"; ids: string[]; location: string }
  | { kind: "photo"; itemId: string; id: string; role: "tool" | "serial" | "extra"; blob: Blob }
  | { kind: "done"; id: string }
  | { kind: "cancel"; id: string };

export interface QueueState {
  pending: number;
  /** Set while uploads are stuck (signed out, offline); cleared on the next success. */
  problem: string;
}

const DB_NAME = "ascent-tool-batch";
const STORE = "ops";

let dbPromise: Promise<IDBDatabase | null> | null = null;
// Fallback when IndexedDB is unavailable (private mode on some browsers): the
// queue still works, it just does not survive a reload.
const memory: { key: number; value: BatchOp }[] = [];
let memoryKey = 0;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const r = run(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function put(op: BatchOp): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, "readwrite", (s) => s.add(op));
      return;
    } catch {
      /* quota or a blob the store refused: keep it in memory instead */
    }
  }
  memory.push({ key: ++memoryKey, value: op });
}

async function first(): Promise<{ key: IDBValidKey | number; value: BatchOp; mem: boolean } | null> {
  if (memory.length) return { ...memory[0], mem: true };
  const db = await openDb();
  if (!db) return null;
  const cursor = await tx(db, "readonly", (s) => s.openCursor());
  return cursor ? { key: cursor.key, value: cursor.value as BatchOp, mem: false } : null;
}

async function remove(entry: { key: IDBValidKey | number; mem: boolean }): Promise<void> {
  if (entry.mem) {
    memory.shift();
    return;
  }
  const db = await openDb();
  if (db) await tx(db, "readwrite", (s) => s.delete(entry.key as IDBValidKey));
}

async function count(): Promise<number> {
  const db = await openDb();
  const n = db ? await tx(db, "readonly", (s) => s.count()).catch(() => 0) : 0;
  return n + memory.length;
}

// ---- state for the screen ---------------------------------------------------

let state: QueueState = { pending: 0, problem: "" };
const listeners = new Set<(s: QueueState) => void>();

function emit(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function subscribeQueue(fn: (s: QueueState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

// ---- sending ------------------------------------------------------------------

type Outcome = "ok" | "drop" | "auth" | "retry";

async function classify(res: Response): Promise<Outcome> {
  // An expired session is redirected to the sign-in page, which answers 200 html.
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.status === 401 || res.status === 403 || (res.ok && !json) || res.redirected) return "auth";
  if (res.ok) return "ok";
  if (res.status === 400 || res.status === 404 || res.status === 413) return "drop";
  return "retry";
}

async function send(op: BatchOp): Promise<Outcome> {
  try {
    if (op.kind === "photo") {
      const q = new URLSearchParams({ item: op.itemId, id: op.id, role: op.role });
      const res = await fetch(`/api/tools/batch/photo?${q}`, {
        method: "POST",
        headers: { "Content-Type": op.blob.type || "image/jpeg" },
        body: op.blob,
      });
      return classify(res);
    }
    const body =
      op.kind === "item"
        ? { action: "item", id: op.id, toolId: op.toolId, idSource: op.idSource, mode: op.mode ?? "add", location: op.location ?? "" }
        : op.kind === "location"
          ? { action: "location", ids: op.ids, location: op.location }
          : { action: op.kind, id: op.id };
    const res = await fetch("/api/tools/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return classify(res);
  } catch {
    return "retry"; // offline, or the connection dropped
  }
}

let running = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send everything queued. Safe to call any time; only one loop runs. */
export async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;
  let failures = 0;
  try {
    emit({ pending: await count() });
    for (;;) {
      const entry = await first();
      if (!entry) break;
      const outcome = await send(entry.value);
      if (outcome === "ok" || outcome === "drop") {
        await remove(entry);
        failures = 0;
        emit({ pending: await count(), problem: "" });
        continue;
      }
      failures++;
      emit({
        problem:
          outcome === "auth"
            ? "Uploads paused: sign in again. Nothing is lost."
            : "Uploads waiting for a signal. Nothing is lost.",
      });
      await sleep(Math.min(30_000, 2_000 * 2 ** Math.min(failures, 4)));
    }
  } finally {
    running = false;
  }
}

/** Queue one step and start sending. Resolves once the step is stored on the phone. */
export async function enqueue(op: BatchOp): Promise<void> {
  await put(op);
  emit({ pending: state.pending + 1 });
  void drainQueue();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void drainQueue());
}

/** A random id for an item or a photo. */
export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
}
