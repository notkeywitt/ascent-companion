// Minimal shared-password auth. Works in both the Edge middleware and Node
// route handlers (uses Web Crypto only — no Buffer/Node APIs).
export const AUTH_COOKIE = "companion_auth";

/** Opaque cookie token derived from the password (not reversible to it). */
export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`ascent-companion:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
