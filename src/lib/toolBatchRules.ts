/**
 * Batch add — the rules that need no server (lib/toolBatch.ts holds the rest).
 * Client-safe and unit-tested.
 *
 * A phone captures tools fast: QR → tool photo → serial photo → extras. Claude
 * Code on the office Mac reads the photos later and fills the details in. A run
 * is due when the office asks for one (the Analyze button) or when captures
 * have gone quiet for a while (the sync timer).
 */

/** What a captured photo shows. */
export type BatchPhotoRole = "tool" | "serial" | "extra";
export const BATCH_PHOTO_ROLES: BatchPhotoRole[] = ["tool", "serial", "extra"];

/** capturing → ready → analyzing → added | error. */
export type BatchStatus = "capturing" | "ready" | "analyzing" | "added" | "error";

/** Prefix of an id the app assigns when the QR scan is skipped. */
export const ASSIGNED_PREFIX = "noqr-";

// No 0/o, 1/i/l: an assigned id is read and typed by people.
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** A fresh assigned id, e.g. "noqr-k7m2x". Replace it with a QR id later from Edit. */
export function assignedToolId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length) % ID_ALPHABET.length];
  return ASSIGNED_PREFIX + s;
}

export function isAssignedId(id: string): boolean {
  return id.toLowerCase().startsWith(ASSIGNED_PREFIX);
}

/** The tool id a QR sticker encodes: the bare id, or a URL with `?tool=<id>`. */
export function toolIdFromQr(text: string): string {
  const raw = text.trim();
  return (raw.match(/tool=([^&\s]+)/i)?.[1] ?? raw).trim();
}

/** Minutes with no new capture before the timer starts a run. */
export const QUIET_MINUTES = 30;
/** A run that has not reported back after this long is treated as dead. */
export const STALE_RUN_MINUTES = 120;
/** After a failed run, the timer waits this long before it tries again. */
export const RETRY_AFTER_ERROR_MINUTES = 180;

export interface DueInput {
  now: number; // ms
  /** Items still waiting: status capturing or ready. */
  items: { status: string; updatedAt: string }[];
  /** The analysis log, any order. */
  events: { kind: string; at: string }[];
}

export interface DueAnswer {
  due: boolean;
  reason: "requested" | "quiet" | "";
  ready: number;
  /** Why it is not due, in words, for the log. */
  why: string;
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Is an analysis run due now? Not while one is running (unless it went stale).
 * Due at once when the office asked after the last run started; otherwise due
 * once the newest capture is QUIET_MINUTES old. A failed run is retried by the
 * timer only after RETRY_AFTER_ERROR_MINUTES; a new request retries at once.
 */
export function analysisDue({ now, items, events }: DueInput): DueAnswer {
  const ready = items.filter((i) => i.status === "ready").length;
  const sorted = events.slice().sort((a, b) => ms(a.at) - ms(b.at));
  const lastStart = [...sorted].reverse().find((e) => e.kind === "started");
  const startAt = lastStart ? ms(lastStart.at) : 0;
  const ended = sorted.find((e) => (e.kind === "done" || e.kind === "error") && ms(e.at) >= startAt);
  if (lastStart && !ended && now - startAt < STALE_RUN_MINUTES * 60_000) {
    return { due: false, reason: "", ready, why: "a run is in progress" };
  }
  if (!ready) return { due: false, reason: "", ready, why: "nothing is waiting" };
  const requested = sorted.some((e) => e.kind === "request" && ms(e.at) > startAt);
  if (requested) return { due: true, reason: "requested", ready, why: "" };
  const last = sorted[sorted.length - 1];
  if (last?.kind === "error" && now - ms(last.at) < RETRY_AFTER_ERROR_MINUTES * 60_000) {
    return { due: false, reason: "", ready, why: "the last run failed; waiting before the timer retries" };
  }
  const newest = Math.max(0, ...items.map((i) => ms(i.updatedAt)));
  if (now - newest >= QUIET_MINUTES * 60_000) return { due: true, reason: "quiet", ready, why: "" };
  return { due: false, reason: "", ready, why: `captures are still coming in (waits ${QUIET_MINUTES} quiet minutes)` };
}

/** The details Claude fills in for one tool. Every value is plain text. */
export interface BatchToolFields {
  name: string;
  type: string;
  toolGroup: string;
  serial: string;
  accessories: string;
  condition: string;
}

const FIELD_KEYS: (keyof BatchToolFields)[] = ["name", "type", "toolGroup", "serial", "accessories", "condition"];

/**
 * Trim, cap and fill a result Claude posted. A result with nothing in it is
 * refused. (A new tool also needs a name; `applyResult` checks that, since an
 * update may fill only a serial.)
 */
export function cleanFields(raw: unknown): BatchToolFields | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = {} as BatchToolFields;
  for (const k of FIELD_KEYS) out[k] = String(r[k] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return FIELD_KEYS.some((k) => out[k]) ? out : null;
}

/**
 * Update mode: the fields to write. Only a value Claude filled in that differs
 * from the list's (ignoring case and spacing) — a blank answer never clears one.
 */
export function mergeFields(current: Partial<BatchToolFields>, next: BatchToolFields): Partial<Record<keyof BatchToolFields, string>> {
  const norm = (s: string | undefined) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const out: Partial<Record<keyof BatchToolFields, string>> = {};
  for (const k of FIELD_KEYS) {
    if (next[k] && norm(next[k]) !== norm(current[k])) out[k] = next[k];
  }
  return out;
}

/**
 * The prompt the Tools page copies for a Claude Code session (phone or
 * computer). The /tool-batch skill in the repo does the work; the prompt only
 * says which tools. No ids = every tool waiting.
 */
export function batchPrompt(itemIds: string[], toolIds: string[] = []): string {
  const which = itemIds.length
    ? `Only these batch items: ${itemIds.join(" ")}` +
      (toolIds.length ? `\n(tools ${toolIds.join(", ")})` : "")
    : "All tools waiting in the batch.";
  return [
    "/tool-batch",
    "",
    which,
    "",
    "Read each tool's photos and fill in its details, as the skill says.",
    itemIds.length ? `Start with: node scripts/tool-batch/agent.mjs begin ${itemIds.join(" ")}` : "Start with: node scripts/tool-batch/agent.mjs begin",
  ].join("\n");
}
