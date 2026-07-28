import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { Role } from "@/lib/views";

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
 * Resolve a signed-in email to its role + per-user view overrides. Env founders
 * are admins; everyone else comes from the allowed_users DB row. Lazy-loads the
 * DB so it never enters the edge/middleware bundle — only ever called from the
 * `jwt` callback on initial sign-in (Node runtime), never per-request on edge.
 */
async function accessForEmail(
  email: string,
): Promise<{ role: Role; va: string[]; vd: string[] }> {
  if (!email) return { role: "field", va: [], vd: [] };
  if (envAllowed().includes(email)) return { role: "admin", va: [], vd: [] };
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
    if (!row) return { role: "field", va: [], vd: [] };
    const role: Role =
      row.role === "admin" ||
      row.role === "office" ||
      row.role === "lead" ||
      row.role === "field"
        ? row.role
        : "field";
    return { role, va: parseIds(row.viewsAllow), vd: parseIds(row.viewsDeny) };
  } catch {
    return { role: "field", va: [], vd: [] };
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
      }
      return token;
    },
    // Surface the token's role/overrides on the session so middleware
    // (req.auth), server routes, and the layout can read them. (Read the token
    // through a local cast — the next-auth/jwt module augmentation doesn't merge
    // into the callback's token type in this v5 beta, but Session.user does.)
    async session({ session, token }) {
      const t = token as { role?: Role; va?: string[]; vd?: string[] };
      if (session.user) {
        // Founders are always admin — resolved from env (no DB), so a founder
        // is never locked out even on a token minted before roles existed.
        const email = (session.user.email ?? "").toLowerCase();
        const isFounder = email !== "" && envAllowed().includes(email);
        session.user.role = isFounder ? "admin" : t.role ?? "field";
        session.user.viewsAllow = t.va ?? [];
        session.user.viewsDeny = t.vd ?? [];
      }
      return session;
    },
  },
});
