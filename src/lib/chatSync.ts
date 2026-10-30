import { chatUserNames, linkedSpaces, saveTurn, setSpaceSyncedTo, spaceSyncedTo } from "@/lib/chatMemory";
import { listSpaceMessages, type ChatApiMessage } from "@/lib/googleChatPost";

/**
 * AscentBot hears every message in a job space, not only the ones that
 * @mention it. Google sends a Chat app only its @mentions, so this READS each
 * space through the Chat API (app authentication, the admin-approved
 * `chat.app.messages.readonly` scope) and keeps what people said to each
 * other as "said" turns in the bot's memory, filed under the space's job.
 * `search_job_memory` then finds "the tile is delayed to Friday" like any note.
 *
 * No AI here: messages are stored as written, so reading costs nothing.
 * Questions to the bot and its answers are skipped — the event route already
 * stores those. The cursor (`chat_space_sync`) is the newest message time
 * stored, so each read starts where the last one stopped.
 *
 * Runs before each question in a space (route.ts) and once a day for every
 * space (/api/google-chat/sync). Read-only against Google. Server-only.
 */

/** How far back the first read of a space goes. */
const FIRST_READ_DAYS = 90;

/** Fields every plain message carries. Anything else is logged by name. */
const KNOWN_FIELDS = new Set([
  "name", "sender", "createTime", "lastUpdateTime", "text", "formattedText", "thread", "space",
  "argumentText", "annotations", "threadReply", "retentionSettings", "slashCommand",
]);

/** Is this message for the bot (stored by the event route) or from it? Then skip it. */
export function isBotTraffic(m: ChatApiMessage): boolean {
  if (m.sender?.type === "BOT") return true;
  if (m.slashCommand) return true;
  return (m.annotations ?? []).some((a) => a.type === "USER_MENTION" && a.userMention?.user?.type === "BOT");
}

/** Read one space's new messages into memory. Returns how many were stored. */
export async function syncSpace(space: string, jobId: string, oidcToken: string, maxPages = 5): Promise<number> {
  const since =
    (await spaceSyncedTo(space)) || new Date(Date.now() - FIRST_READ_DAYS * 24 * 3600 * 1000).toISOString();
  const { messages } = await listSpaceMessages(space, since, oidcToken, maxPages);
  if (!messages.length) return 0;

  const names = await chatUserNames(messages.map((m) => m.sender?.name ?? ""));
  let stored = 0;
  for (const m of messages) {
    const text = (m.text ?? "").trim();
    // What a message carries besides text (an email forwarded from Gmail, a file,
    // a card): field names and text length only, never the content.
    const extra = Object.keys(m).filter((k) => !KNOWN_FIELDS.has(k));
    if (extra.length) console.log(`[chat-sync] ${space} message ${m.name}: text ${text.length} chars; also ${extra.join(", ")}`);
    if (!text || isBotTraffic(m)) continue;
    const author = names.get(m.sender?.name ?? "") || m.sender?.displayName || "Someone";
    await saveTurn({ space, thread: m.thread?.name ?? "", jobId, kind: "said", author, text, at: m.createTime });
    stored++;
  }
  console.log(`[chat-sync] ${space}: read ${messages.length}, stored ${stored}`);
  // The newest time read, kept or skipped: the next read starts after it either way.
  await setSpaceSyncedTo(space, messages[messages.length - 1].createTime);
  return stored;
}

/** Read every job space. One space's failure is logged and the rest go on. */
export async function syncAllSpaces(oidcToken: string): Promise<{ spaces: number; stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;
  const spaces = await linkedSpaces();
  for (const s of spaces) {
    try {
      stored += await syncSpace(s.space, s.jobId, oidcToken, 20);
    } catch (e) {
      failed++;
      console.error(`[chat-sync] ${s.space} (${s.jobName}): ${e instanceof Error ? e.message : e}`);
    }
  }
  return { spaces: spaces.length, stored, failed };
}
