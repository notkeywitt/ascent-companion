/**
 * AscentBot's memory — which job a Google Chat space is about, and what was
 * said there: questions, answers, decisions it was told to keep, and (kind
 * "said", once space reading is on) what people said to each other.
 *
 * Companion DB only (tables chat_space_jobs, chat_turns, chat_space_sync,
 * chat_users). Nothing here touches JobTread. Server-only.
 */

import { and, desc, eq, inArray, like, or } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { chatSpaceJobs, chatSpaceSync, chatTurns, chatUsers } from "@/db/schema";

/** "said" = a message between people in the space, read by chatSync.ts. */
export type TurnKind = "question" | "answer" | "note" | "said";

export interface ChatTurn {
  kind: TurnKind;
  author: string;
  text: string;
  at: string;
}

export interface SpaceJob {
  jobId: string;
  jobName: string;
}

export async function getSpaceJob(space: string): Promise<SpaceJob | null> {
  if (!space) return null;
  await ensureDb();
  const [row] = await db.select().from(chatSpaceJobs).where(eq(chatSpaceJobs.space, space)).limit(1);
  return row ? { jobId: row.jobId, jobName: row.jobName } : null;
}

export async function linkSpaceJob(space: string, job: SpaceJob, email: string): Promise<void> {
  await ensureDb();
  const row = { jobId: job.jobId, jobName: job.jobName, linkedBy: email, linkedAt: new Date().toISOString() };
  await db
    .insert(chatSpaceJobs)
    .values({ space, ...row })
    .onConflictDoUpdate({ target: chatSpaceJobs.space, set: row });
}

/** The space's newest turns, oldest first. */
export async function recentTurns(space: string, limit = 20): Promise<ChatTurn[]> {
  if (!space) return [];
  await ensureDb();
  const rows = await db
    .select()
    .from(chatTurns)
    .where(eq(chatTurns.space, space))
    .orderBy(desc(chatTurns.at), desc(chatTurns.id))
    .limit(limit);
  return rows.reverse().map((r) => ({ kind: r.kind as TurnKind, author: r.author, text: r.text, at: r.at }));
}

export async function saveTurn(t: {
  space: string;
  thread: string;
  jobId: string;
  kind: TurnKind;
  author: string;
  text: string;
  /** When it was said. Defaults to now; a synced message keeps its own time. */
  at?: string;
}): Promise<void> {
  if (!t.space || !t.text.trim()) return;
  await ensureDb();
  await db.insert(chatTurns).values({ ...t, text: t.text.trim(), at: t.at ?? new Date().toISOString() });
}

/** Every space tied to a job. */
export async function linkedSpaces(): Promise<({ space: string } & SpaceJob)[]> {
  await ensureDb();
  const rows = await db.select().from(chatSpaceJobs);
  return rows.map((r) => ({ space: r.space, jobId: r.jobId, jobName: r.jobName }));
}

/** The newest message time read from a space, "" before the first read. */
export async function spaceSyncedTo(space: string): Promise<string> {
  await ensureDb();
  const [row] = await db.select().from(chatSpaceSync).where(eq(chatSpaceSync.space, space)).limit(1);
  return row?.syncedTo ?? "";
}

export async function setSpaceSyncedTo(space: string, syncedTo: string): Promise<void> {
  await ensureDb();
  await db
    .insert(chatSpaceSync)
    .values({ space, syncedTo })
    .onConflictDoUpdate({ target: chatSpaceSync.space, set: { syncedTo } });
}

/** Remember a person's display name from an event, keyed by Google's "users/123". */
export async function rememberChatUser(user: string, name: string, email: string): Promise<void> {
  if (!/^users\/\w+$/.test(user) || !name) return;
  await ensureDb();
  const row = { name, email, seenAt: new Date().toISOString() };
  await db.insert(chatUsers).values({ user, ...row }).onConflictDoUpdate({ target: chatUsers.user, set: row });
}

/** Display names for "users/123" ids, as far as they are known. */
export async function chatUserNames(users: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(users.filter(Boolean))];
  if (!ids.length) return new Map();
  await ensureDb();
  const rows = await db.select().from(chatUsers).where(inArray(chatUsers.user, ids));
  return new Map(rows.map((r) => [r.user, r.name]));
}

/**
 * Everything said to the bot about one job that contains ANY of the words (a
 * stem like "plumb" finds "plumber" and "plumbing"), newest first. No words →
 * the newest turns. Notes and questions both count: a question often carries
 * the decision ("we went with the Ocean tile — what's the lead time?").
 */
export async function searchJobMemory(jobId: string, words: string, limit = 20): Promise<ChatTurn[]> {
  if (!jobId) return [];
  await ensureDb();
  const terms = words
    .split(/\s+/)
    .map((w) => w.replace(/[%_]/g, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const rows = await db
    .select()
    .from(chatTurns)
    .where(
      terms.length
        ? and(eq(chatTurns.jobId, jobId), or(...terms.map((w) => like(chatTurns.text, `%${w}%`))))
        : eq(chatTurns.jobId, jobId),
    )
    .orderBy(desc(chatTurns.at))
    .limit(limit);
  return rows.map((r) => ({ kind: r.kind as TurnKind, author: r.author, text: r.text, at: r.at }));
}
