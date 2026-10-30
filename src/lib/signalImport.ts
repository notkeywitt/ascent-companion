import { timingSafeEqual } from "node:crypto";

import { saveTurns, storedThreads } from "@/lib/chatMemory";
import { advanceSignalChat, SENT_RULES, signalChatRules, type SignalChatReport } from "@/lib/signalChats";

/**
 * Signal group messages into AscentBot's memory. The office Mac mini runs
 * scripts/signal-sync/signal_sync.py twice a day. Each run POSTs to
 * /api/google-chat/signal-import twice:
 *
 *   { chats: [...] }     every chat it has (signalChats.ts records them), and
 *                        gets back each chat's rule and cursor
 *   { messages: [...] }  the new messages of the chats set to a job or the
 *                        office, at most 200 a request
 *
 * The rules live HERE, set on the AscentBot page, so the server re-checks
 * them: a message from a chat that is not set to a job or the office is
 * refused, and the job id comes from the rule, never from the Mac.
 *
 * Each message becomes a "said" turn in space "signal:<chat>", with `thread`
 * "signal:<message id>". A message already stored is skipped, so a batch sent
 * twice stores once. No AI here. Server-only.
 */

/** The most messages one POST may carry. The Mac script sends 200 at a time. */
export const SIGNAL_BATCH_MAX = 200;
/** The most chats one report may carry. */
export const SIGNAL_CHATS_MAX = 1000;
/** Characters kept of one message. */
const TEXT_MAX = 4000;

export interface SignalMessage {
  /** Signal's own message id. */
  id: string;
  /** The chat's name, as shown in Signal. */
  chat: string;
  author: string;
  text: string;
  /** ISO time it was sent. */
  at: string;
  /** Signal's received_at: the chat's cursor moves to the newest one stored. */
  received: number;
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
const iso = (v: unknown) => {
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

/** The well-formed chats of a report, or an error naming what is wrong. */
export function cleanChatReport(list: unknown): { chats: SignalChatReport[] } | { error: string } {
  if (!Array.isArray(list)) return { error: "Pass { chats: [...] }." };
  if (list.length > SIGNAL_CHATS_MAX) return { error: `At most ${SIGNAL_CHATS_MAX} chats per report.` };
  const chats: SignalChatReport[] = [];
  for (const raw of list) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const chat = str(c.chat);
    if (!chat) return { error: "A chat has no name." };
    chats.push({
      chat,
      type: str(c.type) === "group" ? "group" : "private",
      messages: Math.max(0, Math.floor(Number(c.messages) || 0)),
      lastAt: iso(c.lastAt),
    });
  }
  return { chats };
}

/** The well-formed messages of a POST, or an error naming what is wrong. */
export function cleanSignalBatch(list: unknown): { messages: SignalMessage[] } | { error: string } {
  if (!Array.isArray(list)) return { error: "Pass { messages: [...] }." };
  if (list.length > SIGNAL_BATCH_MAX) return { error: `At most ${SIGNAL_BATCH_MAX} messages per request.` };
  const messages: SignalMessage[] = [];
  for (const raw of list) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const msg = {
      id: str(m.id),
      chat: str(m.chat),
      author: str(m.author) || "Someone",
      text: str(m.text).slice(0, TEXT_MAX),
      at: iso(m.at),
      received: Math.max(0, Math.floor(Number(m.received) || 0)),
    };
    if (!msg.id || !msg.chat || !msg.text || !msg.at) return { error: `Message ${msg.id || "(no id)"} lacks id, chat, text or time.` };
    messages.push(msg);
  }
  return { messages };
}

/**
 * Store the messages not already stored, from chats set to a job or the
 * office. Moves each sending chat's cursor to its newest message.
 */
export async function importSignalMessages(
  messages: SignalMessage[],
): Promise<{ stored: number; skipped: number; refused: number }> {
  const rules = await signalChatRules(messages.map((m) => m.chat));
  const allowed = messages.filter((m) => SENT_RULES.includes(rules.get(m.chat)?.rule ?? ""));
  const thread = (m: SignalMessage) => `signal:${m.id}`;
  const have = await storedThreads(allowed.map(thread));
  const seen = new Set<string>();
  const fresh = allowed.filter((m) => {
    const t = thread(m);
    if (have.has(t) || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  await saveTurns(
    fresh.map((m) => ({
      space: `signal:${m.chat}`,
      thread: thread(m),
      jobId: rules.get(m.chat)?.jobId ?? "",
      kind: "said" as const,
      author: m.author,
      text: m.text,
      at: m.at,
    })),
  );
  const newest = new Map<string, number>();
  for (const m of allowed) newest.set(m.chat, Math.max(newest.get(m.chat) ?? 0, m.received));
  for (const [chat, to] of newest) await advanceSignalChat(chat, to);
  return { stored: fresh.length, skipped: allowed.length - fresh.length, refused: messages.length - allowed.length };
}
