import NextAuth from "next-auth";
import authConfig from "./auth.config";

/** Emails always allowed (env — the founders / bootstrap). */
export function envAllowed(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Full config (with the DB-backed allowlist) — used by the route handlers.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!email) return false;
      if (envAllowed().includes(email)) return true;
      // Lazy-load the DB so it never enters the auth/edge bundle.
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
  },
});
