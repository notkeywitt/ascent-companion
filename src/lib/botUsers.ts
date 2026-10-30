/**
 * AscentBot's roles and askers, in the Companion DB (tables bot_roles,
 * bot_users). The rules for what a role's areas unlock are in botAccess.ts;
 * this file only reads and writes the rows. Server-only.
 */

import { asc, eq, sql } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { botRoles, botUsers, chatUsers } from "@/db/schema";
import { cleanAreas, type BotArea } from "@/lib/botAccess";

export interface BotRole {
  id: string;
  name: string;
  areas: BotArea[];
  /** People on this role. */
  people: number;
}

export interface BotUser {
  email: string;
  name: string;
  roleId: string;
  active: boolean;
  addedBy: string;
  updatedAt: string;
  /** When they last asked the bot, from chat_users; "" when never. */
  lastAsked: string;
}

/** What one asker may draw on, or null when the bot must not answer them. */
export interface BotAccess {
  email: string;
  roleName: string;
  areas: BotArea[];
}

const norm = (email: string) => email.trim().toLowerCase();

export async function getBotAccess(email: string | undefined): Promise<BotAccess | null> {
  if (!email) return null;
  await ensureDb();
  const [row] = await db
    .select({ email: botUsers.email, active: botUsers.active, roleName: botRoles.name, areas: botRoles.areas })
    .from(botUsers)
    .innerJoin(botRoles, eq(botRoles.id, botUsers.roleId))
    .where(eq(botUsers.email, norm(email)))
    .limit(1);
  if (!row || !row.active) return null;
  return { email: row.email, roleName: row.roleName, areas: cleanAreas(row.areas) };
}

export async function listBotRoles(): Promise<BotRole[]> {
  await ensureDb();
  const [roles, counts] = await Promise.all([
    db.select().from(botRoles).orderBy(asc(botRoles.createdAt), asc(botRoles.name)),
    db.select({ roleId: botUsers.roleId, n: sql<number>`count(*)` }).from(botUsers).groupBy(botUsers.roleId),
  ]);
  const by = new Map(counts.map((c) => [c.roleId, Number(c.n)]));
  return roles.map((r) => ({ id: r.id, name: r.name, areas: cleanAreas(r.areas), people: by.get(r.id) ?? 0 }));
}

export async function listBotUsers(): Promise<BotUser[]> {
  await ensureDb();
  const [users, seen] = await Promise.all([
    db.select().from(botUsers).orderBy(asc(botUsers.email)),
    db
      .select({ email: chatUsers.email, at: sql<string>`max(${chatUsers.seenAt})` })
      .from(chatUsers)
      .groupBy(chatUsers.email),
  ]);
  const last = new Map(seen.map((s) => [s.email.toLowerCase(), s.at]));
  return users.map((u) => ({
    email: u.email,
    name: u.name,
    roleId: u.roleId,
    active: !!u.active,
    addedBy: u.addedBy,
    updatedAt: u.updatedAt,
    lastAsked: last.get(u.email) ?? "",
  }));
}

/** Add or change one asker. Throws on a role that does not exist. */
export async function saveBotUser(
  u: { email: string; name: string; roleId: string; active: boolean },
  by: string,
): Promise<void> {
  await ensureDb();
  const [role] = await db.select({ id: botRoles.id }).from(botRoles).where(eq(botRoles.id, u.roleId)).limit(1);
  if (!role) throw new Error("That role no longer exists.");
  const now = new Date().toISOString();
  const set = { name: u.name.trim(), roleId: u.roleId, active: u.active ? 1 : 0, updatedAt: now };
  await db
    .insert(botUsers)
    .values({ email: norm(u.email), ...set, addedBy: by, createdAt: now })
    .onConflictDoUpdate({ target: botUsers.email, set });
}

export async function deleteBotUser(email: string): Promise<void> {
  await ensureDb();
  await db.delete(botUsers).where(eq(botUsers.email, norm(email)));
}

/** Add a role (no id) or rename one and change its areas. Returns its id. */
export async function saveBotRole(r: { id?: string; name: string; areas: BotArea[] }): Promise<string> {
  await ensureDb();
  const name = r.name.trim();
  const areas = JSON.stringify(cleanAreas(r.areas));
  if (r.id) {
    await db.update(botRoles).set({ name, areas }).where(eq(botRoles.id, r.id));
    return r.id;
  }
  const id = `role-${Date.now().toString(36)}`;
  await db.insert(botRoles).values({ id, name, areas, createdAt: new Date().toISOString() });
  return id;
}

/** Remove a role nobody is on. Throws while anyone still holds it. */
export async function deleteBotRole(id: string): Promise<void> {
  await ensureDb();
  const [held] = await db.select({ email: botUsers.email }).from(botUsers).where(eq(botUsers.roleId, id)).limit(1);
  if (held) throw new Error("Move everyone off this role before you delete it.");
  await db.delete(botRoles).where(eq(botRoles.id, id));
}
