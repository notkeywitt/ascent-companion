// User activity tracking — the data layer behind Admin → Activity.
//
// Two writers:
//   • recordLogin  — called from NextAuth's signIn event (src/auth.ts) on every
//     successful Google sign-in. Server-derived, so it can't be spoofed.
//   • recordView   — called from /api/usage-track on each in-app navigation. The
//     email comes from the session in the route, never from the request body.
//
// One reader: getUsageSummary — the windowed rollup the /api/usage route serves.
//
// This module statically imports @/db, so it must only be reached from Node
// runtime code. src/auth.ts (imported by edge middleware) reaches it via a
// dynamic import so it never enters the edge bundle. See the note there.
import { desc, gte, lt } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { usageEvents } from "@/db/schema";

export type UsageKind = "login" | "view";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Insert one activity row. No-ops on a blank email. Best-effort — never throws. */
async function record(
  email: string,
  kind: UsageKind,
  path = "",
  viewId = "",
): Promise<void> {
  const em = (email ?? "").trim().toLowerCase();
  if (!em) return;
  try {
    await ensureDb();
    await db.insert(usageEvents).values({
      email: em,
      kind,
      path,
      viewId,
      createdAt: new Date().toISOString(),
    });
  } catch {
    /* activity logging is never allowed to break a request */
  }
}

/** Record a successful sign-in. */
export function recordLogin(email: string): Promise<void> {
  return record(email, "login");
}

/** Record an in-app page view. */
export function recordView(email: string, path: string, viewId = ""): Promise<void> {
  return record(email, "view", path, viewId);
}

/** Drop activity rows older than `days` (keeps the append-only table bounded). */
export async function pruneUsageEvents(days = 180): Promise<void> {
  try {
    await ensureDb();
    const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
    await db.delete(usageEvents).where(lt(usageEvents.createdAt, cutoff));
  } catch {
    /* pruning is best-effort */
  }
}

export interface UserActivity {
  email: string;
  logins: number;
  views: number;
  lastLogin: string | null; // ISO
  lastActive: string | null; // ISO (most recent event of any kind)
  topViews: { viewId: string; label: string; count: number }[];
}

export interface RecentActivity {
  email: string;
  kind: UsageKind;
  path: string;
  viewId: string;
  at: string; // ISO
}

export interface UsageSummary {
  days: number;
  since: string; // ISO window start
  totals: { activeUsers: number; logins: number; views: number };
  users: UserActivity[]; // sorted by lastActive, most recent first
  recent: RecentActivity[]; // newest first, capped
}

/**
 * Windowed activity rollup for the last `days`. Small team + pruned table, so we
 * pull the window's rows once (hard-capped) and aggregate in JS rather than
 * leaning on SQL group-bys. Users with no activity in the window don't appear.
 */
export async function getUsageSummary(
  days = 30,
  viewLabel?: (viewId: string) => string,
): Promise<UsageSummary> {
  await ensureDb();
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const rows = await db
    .select()
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since))
    .orderBy(desc(usageEvents.createdAt))
    .limit(20000);

  const label = viewLabel ?? ((id: string) => id);

  const byUser = new Map<
    string,
    {
      logins: number;
      views: number;
      lastLogin: string | null;
      lastActive: string | null;
      viewCounts: Map<string, number>;
    }
  >();

  for (const r of rows) {
    let u = byUser.get(r.email);
    if (!u) {
      u = { logins: 0, views: 0, lastLogin: null, lastActive: null, viewCounts: new Map() };
      byUser.set(r.email, u);
    }
    // rows arrive newest-first, so the first time we see a user is their latest.
    if (!u.lastActive) u.lastActive = r.createdAt;
    if (r.kind === "login") {
      u.logins += 1;
      if (!u.lastLogin) u.lastLogin = r.createdAt;
    } else {
      u.views += 1;
      const key = r.viewId || r.path || "(other)";
      u.viewCounts.set(key, (u.viewCounts.get(key) ?? 0) + 1);
    }
  }

  const users: UserActivity[] = [...byUser.entries()]
    .map(([email, u]) => ({
      email,
      logins: u.logins,
      views: u.views,
      lastLogin: u.lastLogin,
      lastActive: u.lastActive,
      topViews: [...u.viewCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([viewId, count]) => ({ viewId, label: label(viewId), count })),
    }))
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  const recent: RecentActivity[] = rows.slice(0, 80).map((r) => ({
    email: r.email,
    kind: (r.kind === "login" ? "login" : "view") as UsageKind,
    path: r.path,
    viewId: r.viewId,
    at: r.createdAt,
  }));

  return {
    days,
    since,
    totals: {
      activeUsers: users.length,
      logins: users.reduce((s, u) => s + u.logins, 0),
      views: users.reduce((s, u) => s + u.views, 0),
    },
    users,
    recent,
  };
}
