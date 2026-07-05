import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe base config (no database) — used by the middleware to verify sessions.
export const authConfig: NextAuthConfig = {
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
};

export default authConfig;
