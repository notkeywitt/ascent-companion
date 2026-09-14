/**
 * Cross-site request check for state-changing requests (the CSRF guard).
 *
 * PURE module — no Node/DB/React imports — so `src/middleware.ts` can import it
 * on the edge runtime, and the tests can exercise it directly.
 *
 * ## Why this exists
 *
 * The session cookie is `SameSite=None` (src/auth.ts), so it is still sent when
 * the app runs inside the Chrome side panel — a third-party context. That
 * setting also switches off the browser's own protection against ANOTHER site
 * making requests with your cookie attached (CSRF — one site acting as you on
 * another). Next.js route handlers carry no replacement for it, and every write
 * route reads its body with `req.json()`, which does not check Content-Type. So
 * a plain-text POST from any page a signed-in person happens to be visiting
 * would reach the handler with their cookie and write to the live JobTread org.
 *
 * The fix is the standard one: for any method that can change something, the
 * request's `Origin` must be this same site.
 *
 * ## Why comparing Origin against Host is the right test
 *
 * A browser sets `Origin` itself and a page cannot forge it. `Host` is the site
 * the request actually arrived at. If the two match, the request came from our
 * own pages. Deriving the allowed value from `Host` — rather than hardcoding a
 * URL — means production, every Vercel preview URL, and localhost all work with
 * no configuration to keep in sync.
 *
 * ## Why a missing Origin is allowed
 *
 * Browsers always send `Origin` on POST, so a cross-site attack cannot omit it.
 * A request with no `Origin` is a non-browser caller (Vercel Cron, a
 * server-to-server call). Those carry no cookie to abuse, so they are not what
 * this guards against — and each one already authenticates itself.
 *
 * ## The side panel is unaffected
 *
 * The panel embeds the app's OWN pages in an iframe. Fetches those pages make
 * are same-origin, so their `Origin` is this host and they pass. Only the cookie
 * is in a third-party context, which is what `SameSite=None` is for.
 */

/** Methods that cannot change server state, per HTTP. Everything else is guarded. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when this method can change something, so it needs the origin check. */
export function isStateChanging(method: string | null | undefined): boolean {
  return !SAFE_METHODS.has((method ?? "").trim().toUpperCase());
}

/** Lowercased, trailing slash removed — how both sides of the compare are held. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

/** A host that is a developer's own machine, which serves over plain http. */
function isLoopback(host: string): boolean {
  const name = host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name === "::1";
}

/**
 * The origins that count as "this site" for a request that arrived at `host`.
 *
 * https always; http only for a loopback host, because a dev machine has no
 * certificate. `extra` is an optional comma-separated list (env
 * COMPANION_ALLOWED_ORIGINS) for the day the app answers on a second domain —
 * a custom domain alongside the vercel.app one, say.
 */
export function allowedOrigins(
  host: string | null | undefined,
  extra?: string | null,
): Set<string> {
  const out = new Set<string>();
  const h = normalize(host);
  if (h) {
    out.add(`https://${h}`);
    if (isLoopback(h)) out.add(`http://${h}`);
  }
  for (const raw of (extra ?? "").split(",")) {
    const o = normalize(raw);
    if (o) out.add(o);
  }
  return out;
}

/**
 * Should this request be allowed through the cross-site check?
 *
 * `true` for every safe method, for a request with no `Origin` (not a browser),
 * and for an `Origin` that matches the host it arrived at. `false` otherwise —
 * including the literal "null" origin, which is what a sandboxed iframe or a
 * `data:` document sends, and is never one of our own pages.
 */
export function isSameSiteRequest(
  method: string | null | undefined,
  origin: string | null | undefined,
  host: string | null | undefined,
  extra?: string | null,
): boolean {
  if (!isStateChanging(method)) return true;
  const o = normalize(origin);
  if (!o) return true; // no Origin header = not a browser
  if (o === "null") return false; // opaque origin — never one of ours
  return allowedOrigins(host, extra).has(o);
}
