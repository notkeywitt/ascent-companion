import { timingSafeEqual } from "node:crypto";

import { saveTurns, storedThreads } from "@/lib/chatMemory";

/**
 * Signal group messages into AscentBot's memory. The office Mac mini runs
 * scripts/signal-sync/signal_sync.py twice a day: it reads Signal Desktop's
 * database, keeps only the chats listed in its allowlist, and POSTs them to
 * /api/google-chat/signal-import, which calls importSignalMessages here.
 *
 * Each message becomes a "said" turn in space "signal:<chat>", with `thread`
 * "signal:<message id>". A job group carries its JobTread job id, so
 * search_job_memory finds it; an office group carries none, and
 * search_team_chat finds it by words. A message already stored is skipped, so
 * a batch sent twice stores once. No AI here. Server-only.
 */

/** The most messages one POST may carry. The Mac script sends 200 at a time. */
export const SIGNAL_BATCH_MAX = 200;
/** Characters kept of one message. */
const TEXT_MAX = 4000;

export interface SignalMessage {
  /** Signal's own message id. */
  id: string;
  /** The chat's name, as shown in Signal. */
  chat: string;
  /** The JobTread job id, or "" for an office group. */
  jobId: string;
  author: string;
  text: string;
  /** ISO time it was sent. */
  at: string;
}

/** Is the bearer header the import secret? Constant-time. */
export function signalSecretOk(authorization: string, expected: string): boolean {
  const want = expected.trim();
  const provided = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!want || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The well-formed messages of a POST body, or an error naming what is wrong. */
export function cleanSignalBatch(body: unknown): { messages: SignalMessage[] } | { error: string } {
  const list = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(list)) return { error: "Pass { messages: [...] }." };
  if (list.length > SIGNAL_BATCH_MAX) return { error: `At most ${SIGNAL_BATCH_MAX} messages per request.` };
  const messages: SignalMessage[] = [];
  for (const raw of list) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const at = new Date(str(m.at));
    const msg = {
      id: str(m.id),
      chat: str(m.chat),
      jobId: str(m.jobId),
      author: str(m.author) || "Someone",
      text: str(m.text).slice(0, TEXT_MAX),
      at: Number.isNaN(at.getTime()) ? "" : at.toISOString(),
    };
    if (!msg.id || !msg.chat || !msg.text || !msg.at) return { error: `Message ${msg.id || "(no id)"} lacks id, chat, text or time.` };
    messages.push(msg);
  }
  return { messages };
}

/** Store the messages not already stored. */
export async function importSignalMessages(messages: SignalMessage[]): Promise<{ stored: number; skipped: number }> {
  const thread = (m: SignalMessage) => `signal:${m.id}`;
  const have = await storedThreads(messages.map(thread));
  const seen = new Set<string>();
  const fresh = messages.filter((m) => {
    const t = thread(m);
    if (have.has(t) || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  await saveTurns(
    fresh.map((m) => ({
      space: `signal:${m.chat}`,
      thread: thread(m),
      jobId: m.jobId,
      kind: "said" as const,
      author: m.author,
      text: m.text,
      at: m.at,
    })),
  );
  return { stored: fresh.length, skipped: messages.length - fresh.length };
}
