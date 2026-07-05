import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Emails always allowed (env — the founders / bootstrap). */
export function envAllowed(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.APP_PASSWORD ?? "local-dev-only-secret",
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID?.trim(),
      clientSecret: process.env.AUTH_GOOGLE_SECRET?.trim(),
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
  },
});
