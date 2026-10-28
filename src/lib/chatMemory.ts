/**
 * AscentBot's memory — which job a Google Chat space is about, and what was
 * said to the bot there (questions, answers, decisions it was told to keep).
 *
 * Companion DB only (tables chat_space_jobs, chat_turns). Nothing here touches
 * JobTread. Server-only.
 */

import { and, desc, eq, like, or } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { chatSpaceJobs, chatTurns } from "@/db/schema";

export type TurnKind = "question" | "answer" | "note";

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
}): Promise<void> {
  if (!t.space || !t.text.trim()) return;
  await ensureDb();
  await db.insert(chatTurns).values({ ...t, text: t.text.trim(), at: new Date().toISOString() });
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
