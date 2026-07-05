import NextAuth from "next-auth";
import { eq } from "drizzle-orm";
import authConfig from "./auth.config";
import { db, ensureDb } from "@/db";
import { allowedUsers } from "@/db/schema";

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
      try {
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
