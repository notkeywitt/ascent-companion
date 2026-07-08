import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Emails always allowed (env — the founders / bootstrap). */
export function envAllowed(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// In production the session-signing secret must be a real secret — falling
// back to the shared password (low entropy) or a public constant would make
// session cookies forgeable.
// `next build` also runs with NODE_ENV=production but without deploy env vars,
// so only enforce at actual runtime (NEXT_PHASE is set during the build).
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const AUTH_SECRET =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" && !isBuildPhase
    ? undefined
    : process.env.APP_PASSWORD ?? "local-dev-only-secret");
if (!AUTH_SECRET) {
  throw new Error("AUTH_SECRET must be set in production (generate one with `npx auth secret`).");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: AUTH_SECRET,
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
