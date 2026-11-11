import { eq, inArray, sql } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { chatTurns, companyDetails, signalChats } from "@/db/schema";

/**
 * The Signal chats on the office Mac mini, and what AscentBot may do with
 * each. The Mac script reports every chat each run (reportSignalChats); the
 * AscentBot page assigns each one (setSignalChatRule). A new chat starts "not
 * set" and sends nothing until someone assigns it.
 *
 *   job     its messages are filed under that JobTread job (search_job_memory)
 *   office  a crew-wide group: kept with no job (search_team_chat)
 *   skip    never sent
 *
 * Companion DB only. Server-only.
 */

export type SignalRule = "" | "job" | "office" | "skip";
export const SENT_RULES: SignalRule[] = ["job", "office"];

export interface SignalChatReport {
  chat: string;
  type: string;
  messages: number;
  lastAt: string;
}

export interface SignalChat extends SignalChatReport {
  rule: SignalRule;
  jobId: string;
  jobName: string;
  sentTo: number;
  setBy: string;
  setAt: string;
  /** Messages of this chat in AscentBot's memory. */
  kept: number;
}

const space = (chat: string) => `signal:${chat}`;

const asRule = (v: string): SignalRule => (["job", "office", "skip"].includes(v) ? (v as SignalRule) : "");

/** Record the chats the Mac has. Returns each one's rule and cursor. */
export async function reportSignalChats(
  chats: SignalChatReport[],
): Promise<{ chat: string; rule: SignalRule; jobId: string; sentTo: number }[]> {
  if (!chats.length) return [];
  await ensureDb();
  const now = new Date().toISOString();
  for (const c of chats) {
    const counts = { type: c.type, messages: c.messages, lastAt: c.lastAt, seenAt: now };
    await db
      .insert(signalChats)
      .values({ chat: c.chat, ...counts })
      .onConflictDoUpdate({ target: signalChats.chat, set: counts });
  }
  const rows = await db.select().from(signalChats).where(inArray(signalChats.chat, chats.map((c) => c.chat)));
  return rows.map((r) => ({ chat: r.chat, rule: asRule(r.rule), jobId: r.jobId, sentTo: r.sentTo }));
}

/** The rule of each named chat. A chat never reported has none. */
export async function signalChatRules(chats: string[]): Promise<Map<string, { rule: SignalRule; jobId: string }>> {
  const names = [...new Set(chats)];
  if (!names.length) return new Map();
  await ensureDb();
  const rows = await db.select().from(signalChats).where(inArray(signalChats.chat, names));
  return new Map(rows.map((r) => [r.chat, { rule: asRule(r.rule), jobId: r.jobId }]));
}

/** Move a chat's cursor forward, never back. */
export async function advanceSignalChat(chat: string, receivedTo: number): Promise<void> {
  await ensureDb();
  await db
    .update(signalChats)
    .set({ sentTo: sql`max(${signalChats.sentTo}, ${receivedTo})` })
    .where(eq(signalChats.chat, chat));
}

/** Every chat, with how many of its messages AscentBot holds. */
export async function listSignalChats(): Promise<SignalChat[]> {
  await ensureDb();
  const rows = await db.select().from(signalChats);
  const kept = await db
    .select({ space: chatTurns.space, n: sql<number>`count(*)` })
    .from(chatTurns)
    .where(sql`${chatTurns.space} LIKE 'signal:%'`)
    .groupBy(chatTurns.space);
  const keptBy = new Map(kept.map((k) => [k.space, Number(k.n)]));
  return rows.map((r) => ({
    chat: r.chat,
    type: r.type,
    messages: r.messages,
    lastAt: r.lastAt,
    rule: asRule(r.rule),
    jobId: r.jobId,
    jobName: r.jobName,
    sentTo: r.sentTo,
    setBy: r.setBy,
    setAt: r.setAt,
    kept: keptBy.get(space(r.chat)) ?? 0,
  }));
}

/**
 * Assign a chat. To a job or the office: its messages already kept move with
 * it. To skip or not set: its kept messages are removed from AscentBot's
 * memory and its cursor goes back to 0, so assigning it again later sends its
 * whole history.
 */
export async function setSignalChatRule(
  chat: string,
  next: { rule: SignalRule; jobId: string; jobName: string },
  by: string,
): Promise<void> {
  await ensureDb();
  const sends = SENT_RULES.includes(next.rule);
  const jobId = next.rule === "job" ? next.jobId : "";
  const row = {
    rule: next.rule,
    jobId,
    jobName: next.rule === "job" ? next.jobName : "",
    setBy: by,
    setAt: new Date().toISOString(),
    ...(sends ? {} : { sentTo: 0 }),
  };
  const updated = await db.update(signalChats).set(row).where(eq(signalChats.chat, chat)).returning({ chat: signalChats.chat });
  if (!updated.length) throw new Error(`No Signal chat named "${chat}".`);
  if (sends) {
    await db.update(chatTurns).set({ jobId }).where(eq(chatTurns.space, space(chat)));
  } else {
    await db.delete(chatTurns).where(eq(chatTurns.space, space(chat)));
  }
}

// --- "Run now" ---------------------------------------------------------------
// The scraper runs on the Mac, which a Vercel page cannot start. The page
// stores a request time; a one-minute launchd job on the Mac asks for it
// (`signal_sync.py --poll`), runs the sync when it is newer than the last one
// it handled, and reports back. Both facts live in company_details, so no
// schema change.

const REQUEST_KEY = "signal_sync_requested_at";
const RUN_KEY = "signal_sync_last_run";

export interface SignalRunStatus {
  /** ISO time of the newest "Run now" click, "" when never. */
  requestedAt: string;
  /** ISO time the Mac last finished a run that was asked for, "" when never. */
  ranAt: string;
  /** One line: what that run did. */
  summary: string;
}

async function detail(key: string): Promise<{ value: string; updatedAt: string }> {
  await ensureDb();
  const [row] = await db.select().from(companyDetails).where(eq(companyDetails.key, key));
  return { value: row?.value ?? "", updatedAt: row?.updatedAt ?? "" };
}

async function putDetail(key: string, value: string, by: string): Promise<void> {
  await ensureDb();
  const row = { value, updatedAt: new Date().toISOString(), updatedBy: by };
  await db
    .insert(companyDetails)
    .values({ key, ...row })
    .onConflictDoUpdate({ target: companyDetails.key, set: row });
}

export async function signalRunStatus(): Promise<SignalRunStatus> {
  const [req, run] = await Promise.all([detail(REQUEST_KEY), detail(RUN_KEY)]);
  return { requestedAt: req.value, ranAt: run.updatedAt, summary: run.value };
}

/** A person pressed "Run now". Returns the new request time. */
export async function requestSignalRun(by: string): Promise<string> {
  const at = new Date().toISOString();
  await putDetail(REQUEST_KEY, at, by);
  return at;
}

/** The Mac finished the run it was asked for. */
export async function recordSignalRun(summary: string): Promise<void> {
  await putDetail(RUN_KEY, summary.slice(0, 300), "mac");
}
