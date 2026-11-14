/**
 * THE MILEAGE OUTBOX — a finished trip the phone has sent but not seen saved.
 *
 * THE PROBLEM. Ending a trip is one POST to /api/mileage, and that call is slow:
 * Google Routes, then Apps Script appends the sheet row. A driver who tapped
 * End and left the screen, or closed the app, before the reply lost the trip.
 *
 * THE FIX, three parts:
 *
 *   1. The save is written HERE, to localStorage, before it is sent. It leaves
 *      only on a confirmed save (or a request the server refuses for good).
 *   2. It is sent with `keepalive`, so the browser finishes the request after
 *      the page closes.
 *   3. `MileageOutbox` (mounted app-wide in layout.tsx) sends anything still
 *      here when the app opens, comes back online or comes back on screen.
 *
 * A resend can follow a first send that did save. The server claims each
 * client key (`src/lib/mileageSaves.ts`), so the trip still lands once.
 *
 * The open trip (`mileageTrip.ts`) stays on the phone until the save is
 * confirmed, and `sendSave` clears it then.
 */
import { clearLocalTrip, readLocalTrip } from "@/lib/mileageTrip";

export const LS_OUTBOX = "mileage.outbox";
/** The window event every send ends with. `detail` is a `SaveEvent`. */
export const SAVE_EVENT = "mileage-save";
/** A send younger than this may still be in flight; it is not sent again. */
export const RETRY_GAP_MS = 30_000;
/** A save this old is dropped. The server keeps its claim for 30 days. */
export const OUTBOX_EXPIRE_DAYS = 14;
/** `keepalive` refuses a body over 64 KB; leave room for the headers. */
const KEEPALIVE_MAX = 60_000;

export interface PendingSave {
  /** The client key: the trip's `tripKey`. The server dedupes on it. */
  key: string;
  /** The POST /api/mileage body, as sent. */
  body: Record<string, unknown>;
  queuedAt: string; // ISO
  lastTryAt: string; // ISO, "" before the first send
  tries: number;
}

/** ok = saved. retry = keep it and send again. drop = the server will never take it. */
export type SaveOutcome = "ok" | "retry" | "drop";

export interface SaveReply {
  ok?: boolean;
  error?: string;
  busy?: boolean;
  miles?: number | null;
  [k: string]: unknown;
}

export interface SaveEvent {
  key: string;
  outcome: SaveOutcome;
  status: number; // 0 = no answer
  reply: SaveReply;
  body: Record<string, unknown>;
}

// ------------------------------------------------------------------ pure

/** Read an unknown shape as the outbox list. Bad entries are skipped. */
export function parseOutbox(v: unknown): PendingSave[] {
  if (!Array.isArray(v)) return [];
  const out: PendingSave[] = [];
  for (const e of v) {
    const o = e as Partial<PendingSave> | null;
    if (!o || typeof o.key !== "string" || !o.key || !o.body || typeof o.body !== "object") continue;
    out.push({
      key: o.key,
      body: o.body as Record<string, unknown>,
      queuedAt: String(o.queuedAt ?? ""),
      lastTryAt: String(o.lastTryAt ?? ""),
      tries: Number(o.tries) || 0,
    });
  }
  return out;
}

/** Add a save, or replace the one with the same key. */
export function upsertSave(list: PendingSave[], entry: PendingSave): PendingSave[] {
  return [...list.filter((e) => e.key !== entry.key), entry];
}

/** True when the save has waited past the expiry. */
export function isExpired(e: PendingSave, now = Date.now()): boolean {
  const t = Date.parse(e.queuedAt);
  return Number.isFinite(t) && now - t > OUTBOX_EXPIRE_DAYS * 86_400_000;
}

/** The saves to send now: not expired, and not sent in the last RETRY_GAP_MS. */
export function dueSaves(list: PendingSave[], now = Date.now()): PendingSave[] {
  return list.filter((e) => {
    if (isExpired(e, now)) return false;
    const t = Date.parse(e.lastTryAt);
    return !Number.isFinite(t) || now - t >= RETRY_GAP_MS;
  });
}

/**
 * What a reply means for the save. Only a request the route rejects as bad
 * (400, 413, 422) is dropped. Everything else, including signed out (401), a
 * send still running (409) and Apps Script's own `ok:false`, is kept.
 */
export function classify(status: number, reply: SaveReply): SaveOutcome {
  if (status >= 200 && status < 300 && reply.ok !== false) return "ok";
  if (status === 400 || status === 413 || status === 422) return "drop";
  return "retry";
}

// --------------------------------------------------------------- storage

export function readOutbox(): PendingSave[] {
  try {
    const raw = localStorage.getItem(LS_OUTBOX);
    return raw ? parseOutbox(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeOutbox(list: PendingSave[]): void {
  try {
    if (list.length) localStorage.setItem(LS_OUTBOX, JSON.stringify(list));
    else localStorage.removeItem(LS_OUTBOX);
  } catch {}
}

/** The waiting save for this key, if any. */
export function pendingSave(key: string): PendingSave | null {
  if (!key) return null;
  return readOutbox().find((e) => e.key === key) ?? null;
}

/** Write a save to the outbox before it is sent. Replaces one with the same key. */
export function queueSave(key: string, body: Record<string, unknown>): PendingSave {
  const entry: PendingSave = { key, body, queuedAt: new Date().toISOString(), lastTryAt: "", tries: 0 };
  writeOutbox(upsertSave(readOutbox(), entry));
  return entry;
}

export function removeSave(key: string): void {
  writeOutbox(readOutbox().filter((e) => e.key !== key));
}

// ------------------------------------------------------------------ send

/**
 * Send one save and settle it: removed on ok or drop, kept on retry. The open
 * trip with this key is cleared on ok. Every send ends with a SAVE_EVENT.
 */
export async function sendSave(entry: PendingSave): Promise<SaveEvent> {
  // Stamp the try BEFORE sending, so another tab or a remount waits for it.
  const stamped = { ...entry, lastTryAt: new Date().toISOString(), tries: entry.tries + 1 };
  if (readOutbox().some((e) => e.key === entry.key)) writeOutbox(upsertSave(readOutbox(), stamped));

  const body = JSON.stringify(entry.body);
  let status = 0;
  let reply: SaveReply = {};
  try {
    const res = await fetch("/api/mileage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length < KEEPALIVE_MAX,
    });
    status = res.status;
    try {
      reply = (await res.json()) as SaveReply;
    } catch {
      reply = { error: `The server answered ${res.status}.` };
    }
  } catch {
    reply = { error: "No connection. The trip is kept on this phone and sends when the app is back online." };
  }

  const outcome: SaveOutcome = status ? classify(status, reply) : "retry";
  if (outcome !== "retry") removeSave(entry.key);
  if (outcome === "ok" && readLocalTrip()?.tripKey === entry.key) clearLocalTrip();

  const ev: SaveEvent = { key: entry.key, outcome, status, reply, body: entry.body };
  try {
    window.dispatchEvent(new CustomEvent<SaveEvent>(SAVE_EVENT, { detail: ev }));
  } catch {}
  return ev;
}

let flushing = false;

/** Send every due save, one at a time. Expired saves are dropped. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    const list = readOutbox();
    const live = list.filter((e) => !isExpired(e, now));
    if (live.length !== list.length) writeOutbox(live);
    for (const e of dueSaves(live, now)) await sendSave(e);
  } finally {
    flushing = false;
  }
}
