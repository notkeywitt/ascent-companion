import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ROLE_VIEWS, resolveAllowedViews, type Role } from "@/lib/views";

/** Emails always allowed (env — the founders / bootstrap). Treated as admins. */
export function envAllowed(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function parseIds(s: string | null | undefined): string[] {
  try {
    const a = JSON.parse(s ?? "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The DB-resolved default view set for a role — the hardcoded ROLE_VIEWS,
 * adjusted by any admin edit made on /admin's Role Defaults editor. "admin"
 * short-circuits with no DB call: it's never overridable, so a bad edit can't
 * lock every admin out of the console that would fix it.
 */
async function roleBaseFor(role: Role): Promise<string[]> {
  if (role === "admin") return ROLE_VIEWS.admin;
  try {
    const { db, ensureDb } = await import("@/db");
    const { roleAccess } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await ensureDb();
    const rows = await db.select().from(roleAccess).where(eq(roleAccess.role, role)).limit(1);
    const row = rows[0];
    if (!row) return ROLE_VIEWS[role];
    return [...resolveAllowedViews(role, parseIds(row.viewsAllow), parseIds(row.viewsDeny))];
  } catch {
    return ROLE_VIEWS[role];
  }
}

/**
 * Resolve a signed-in email to its role + per-user view overrides + that
 * role's (possibly admin-edited) base view set. Env founders are admins;
 * everyone else comes from the allowed_users DB row. Lazy-loads the DB so it
 * never enters the edge/middleware bundle — only ever called from the `jwt`
 * callback on initial sign-in (Node runtime), never per-request on edge.
 */
async function accessForEmail(
  email: string,
): Promise<{ role: Role; va: string[]; vd: string[]; rb: string[] }> {
  if (!email) return { role: "field", va: [], vd: [], rb: await roleBaseFor("field") };
  if (envAllowed().includes(email)) {
    return { role: "admin", va: [], vd: [], rb: await roleBaseFor("admin") };
  }
  try {
    const { db, ensureDb } = await import("@/db");
    const { allowedUsers } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await ensureDb();
    const rows = await db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.email, email))
      .limit(1);
    const row = rows[0];
    if (!row) return { role: "field", va: [], vd: [], rb: await roleBaseFor("field") };
    const role: Role =
      row.role === "admin" ||
      row.role === "office" ||
      row.role === "lead" ||
      row.role === "field"
        ? row.role
        : "field";
    return {
      role,
      va: parseIds(row.viewsAllow),
      vd: parseIds(row.viewsDeny),
      rb: await roleBaseFor(role),
    };
  } catch {
    return { role: "field", va: [], vd: [], rb: await roleBaseFor("field") };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.APP_PASSWORD ?? "local-dev-only-secret",
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID?.trim(),
      clientSecret: process.env.AUTH_GOOGLE_SECRET?.trim(),
      // Always show Google's account chooser instead of silently reusing the
      // one already signed in — so people can pick which account to use.
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  cookies: {
    // Sent inside the Chrome side-panel iframe (third-party context).
    sessionToken: { options: { httpOnly: true, sameSite: "none", secure: true, path: "/" } },
  },
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!email) return false;
      if (envAllowed().includes(email)) return true;
      // Lazy-load the DB so it never enters the edge/middleware bundle.
      try {
        const { db, ensureDb } = await import("@/db");
        const { allowedUsers } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        await ensureDb();
        const rows = await db
          .select()
          .from(allowedUsers)
          .where(eq(allowedUsers.email, email))
          .limit(1);
        return rows.length > 0;
      } catch {
        return false;
      }
    },
    // Bake role + overrides into the JWT at sign-in only (when `user` is set).
    // On every later request this callback runs on the edge too, but takes the
    // no-DB path and just returns the existing token.
    async jwt({ token, user }) {
      if (user) {
        const email = (user.email ?? token.email ?? "").toLowerCase();
        const access = await accessForEmail(email);
        token.role = access.role;
        token.va = access.va;
        token.vd = access.vd;
        token.rb = access.rb;
      }
      return token;
    },
    // Surface the token's role/overrides on the session so middleware
    // (req.auth), server routes, and the layout can read them. (Read the token
    // through a local cast — the next-auth/jwt module augmentation doesn't merge
    // into the callback's token type in this v5 beta, but Session.user does.)
    async session({ session, token }) {
      const t = token as { role?: Role; va?: string[]; vd?: string[]; rb?: string[] };
      if (session.user) {
        // Founders are always admin — resolved from env (no DB), so a founder
        // is never locked out even on a token minted before roles existed.
        const email = (session.user.email ?? "").toLowerCase();
        const isFounder = email !== "" && envAllowed().includes(email);
        const role = isFounder ? "admin" : t.role ?? "field";
        session.user.role = role;
        session.user.viewsAllow = t.va ?? [];
        session.user.viewsDeny = t.vd ?? [];
        // A token minted before role defaults existed has no `rb` — fall back
        // to the hardcoded default rather than leaving it undefined.
        session.user.roleBase = isFounder ? ROLE_VIEWS.admin : t.rb ?? ROLE_VIEWS[role];
      }
      return session;
    },
  },
  events: {
    // Log every successful sign-in for the Admin → Activity dashboard, and take
    // the opportunity (logins are infrequent) to prune the activity table. Both
    // are lazy-imported so @/db never enters the edge/middleware bundle, exactly
    // like the callbacks above. Best-effort — never block or fail the sign-in.
    async signIn({ user }) {
      const email = (user?.email ?? "").toLowerCase();
      if (!email) return;
      try {
        const { recordLogin, pruneUsageEvents } = await import("@/lib/usage");
        await recordLogin(email);
        await pruneUsageEvents();
      } catch {
        /* activity logging must never break auth */
      }
    },
  },
});
