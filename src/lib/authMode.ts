/**
 * One answer to "is any sign-in method configured at all?".
 *
 * PURE module — safe on the edge runtime and in a route handler alike.
 *
 * Several places need this to keep `npm run dev` usable on a laptop with no
 * Google OAuth client: src/middleware.ts, /api/pave, /api/digest/run,
 * /api/invoice-review/run, /api/invoice-review/learn, and the root layout. They
 * each spelled the test out by hand, and each had to be edited when the shared
 * password was retired. One function now, so the next change is one line.
 *
 * ⚠️ This is a FAIL-OPEN branch: every caller treats `true` as "let it through".
 * A production deployment that lost AUTH_GOOGLE_ID would serve itself to the
 * open internet, and nothing would look broken. Finding H-4 of the September
 * 2026 security review proposes replacing the test with an explicit development
 * flag so that absence of configuration always means "refuse". That change is
 * deliberately NOT made here — it is a behaviour change to every one of those
 * call sites and wants its own review. This module is where it lands.
 */

/** True when no sign-in method is configured — i.e. a local dev machine. */
export function noAuthConfigured(): boolean {
  return !process.env.AUTH_GOOGLE_ID;
}
