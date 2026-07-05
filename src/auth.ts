import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Comma-separated allowlist of Google emails permitted to sign in. */
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Google sign-in is active only when a Google client is configured. */
export const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Vercel sets the host; trust it for callback URLs
  // Never crash for want of a secret: fall back to the shared password (always
  // set in prod) so deploying this before AUTH_SECRET exists is safe.
  secret: process.env.AUTH_SECRET ?? process.env.APP_PASSWORD ?? "local-dev-only-secret",
  providers: [Google],
  callbacks: {
    signIn({ profile }) {
      const list = allowedEmails();
      if (list.length === 0) return true; // no allowlist configured => any Google account
      const email = (profile?.email ?? "").toLowerCase();
      return list.includes(email);
    },
  },
  cookies: {
    // Allow the session cookie in the Chrome side-panel iframe (third-party).
    sessionToken: {
      options: { httpOnly: true, sameSite: "none", secure: true, path: "/" },
    },
  },
});
