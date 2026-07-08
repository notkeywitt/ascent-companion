import { cookies } from "next/headers";
import { auth } from "@/auth";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

/**
 * Route-level auth guard — defense in depth behind the middleware, so a
 * misconfigured deploy (or a middleware bypass) never exposes the JobTread
 * write routes. Returns the principal ("<email>" for Google sessions,
 * "password" for the shared-password cookie, "dev" when nothing is configured
 * outside production) or null when unauthenticated.
 */
export async function requireAuth(): Promise<string | null> {
  const session = await auth();
  if (session?.user?.email) return session.user.email;

  const pw = process.env.APP_PASSWORD;
  if (pw) {
    const jar = await cookies();
    const cookie = jar.get(AUTH_COOKIE)?.value;
    if (cookie && cookie === (await tokenFor(pw))) return "password";
  }

  // Nothing configured => open only outside production (mirrors middleware).
  if (!process.env.AUTH_GOOGLE_ID && !pw && process.env.NODE_ENV !== "production") {
    return "dev";
  }
  return null;
}
