import { eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { jtUserLinks } from "@/db/schema";
import { callAppsScript } from "@/lib/appsScript";

/**
 * Who is this signed-in person, in JobTread?
 *
 * The answer lives on the Employee roster, behind the Apps Script web app — and
 * one round trip there costs ~3 s of Google overhead before the script starts
 * (measured 2026-08-26 against a rejected request, so that is transport alone).
 * /employee-time paid it three times per load. The answer changes only when an
 * admin re-links somebody, so it is cached in the `jt_user_links` table:
 *
 *   read*  — DB only. Never calls Apps Script. Safe on a hot render path.
 *   resolve* — DB first; falls back to Apps Script on a miss (or a stale row,
 *              or force) and writes the answer back.
 *
 * A route that can afford one slow call uses `resolve`; a render path that must
 * not stall uses `read` and lets the page fill itself in afterwards.
 */
export interface JtUserLink {
  email: string;
  name: string;
  jtUserId: string; // "" = on the roster but not linked to a JobTread user
  jtUserName: string;
  employeeId: string;
  updatedAt: string;
}

/** How long a cached link is trusted before it is re-read from the roster. */
const FRESH_MS = 24 * 60 * 60 * 1000;

function rowToLink(r: {
  email: string;
  name: string;
  jtUserId: string;
  jtUserName: string;
  employeeId: string;
  updatedAt: string;
}): JtUserLink {
  return {
    email: r.email,
    name: r.name,
    jtUserId: r.jtUserId,
    jtUserName: r.jtUserName,
    employeeId: r.employeeId,
    updatedAt: r.updatedAt,
  };
}

function isFresh(link: JtUserLink | null): boolean {
  if (!link?.updatedAt) return false;
  const t = Date.parse(link.updatedAt);
  return Number.isFinite(t) && Date.now() - t < FRESH_MS;
}

/** The cached link, straight from the DB. No Apps Script, no network to Google. */
export async function readJtUserLink(email: string): Promise<JtUserLink | null> {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return null;
  try {
    await ensureDb();
    const rows = await db.select().from(jtUserLinks).where(eq(jtUserLinks.email, key)).limit(1);
    return rows[0] ? rowToLink(rows[0]) : null;
  } catch {
    return null; // a DB hiccup must never block a page — the caller falls back
  }
}

/** Write (or refresh) one link. Called after any roster read that resolved it. */
export async function saveJtUserLink(link: Omit<JtUserLink, "updatedAt">): Promise<void> {
  const email = (link.email ?? "").trim().toLowerCase();
  if (!email) return;
  const row = {
    email,
    name: link.name ?? "",
    jtUserId: link.jtUserId ?? "",
    jtUserName: link.jtUserName ?? "",
    employeeId: link.employeeId ?? "",
    updatedAt: new Date().toISOString(),
  };
  try {
    await ensureDb();
    await db
      .insert(jtUserLinks)
      .values(row)
      .onConflictDoUpdate({ target: jtUserLinks.email, set: row });
  } catch {
    /* caching is best-effort: a failed write just means the next load re-reads */
  }
}

/**
 * The link, from the cache when it is fresh, else from the Employee roster.
 *
 * `force` re-reads the roster even when the cache is fresh — for an admin who
 * has just re-linked somebody and wants it to take effect now.
 */
export async function resolveJtUserLink(
  email: string,
  opts: { force?: boolean } = {},
): Promise<JtUserLink | null> {
  const key = (email ?? "").trim().toLowerCase();
  if (!key) return null;

  const cached = await readJtUserLink(key);
  if (!opts.force && isFresh(cached)) return cached;

  const boot = await callAppsScript({ action: "timeEntryBootstrap", email: key });
  if (boot.error) return cached; // Apps Script down — a stale answer beats none
  const b = (boot.data ?? {}) as {
    ok?: boolean;
    me?: { name?: string; jtUserId?: string; jtUserName?: string; employeeId?: string };
  };
  if (b?.ok === false || !b.me) return cached;

  const fresh: Omit<JtUserLink, "updatedAt"> = {
    email: key,
    name: (b.me.name ?? "").trim(),
    jtUserId: (b.me.jtUserId ?? "").trim(),
    jtUserName: (b.me.jtUserName ?? "").trim(),
    employeeId: (b.me.employeeId ?? "").trim(),
  };
  await saveJtUserLink(fresh);
  return { ...fresh, updatedAt: new Date().toISOString() };
}

/** Drop one cached link (an admin re-link) or all of them. */
export async function clearJtUserLink(email?: string): Promise<void> {
  try {
    await ensureDb();
    if (email) {
      await db.delete(jtUserLinks).where(eq(jtUserLinks.email, email.trim().toLowerCase()));
    } else {
      await db.delete(jtUserLinks);
    }
  } catch {
    /* best-effort */
  }
}
