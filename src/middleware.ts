import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { noAuthConfigured } from "@/lib/authMode";
import { isSameSiteRequest } from "@/lib/origin";
import { resolveAllowedViews, viewIdForPath } from "@/lib/views";

// Routes that skip the session check entirely. Everything here authenticates
// ITSELF — /api/digest/run and /api/invoice-review/run are called by the
// scheduler, which carries no Google session, so each verifies a cron bearer
// secret (or an admin session) in its own handler. Being listed here removes
// the session requirement, NOT the authorization; don't add a route that has no
// credential of its own.
//
// Note the review pair: only the `/run` SUBPATH is public. `/api/invoice-review`
// itself is not listed, so it stays behind the `invoice-review` view gate — a
// prefix match here would have opened the whole month's billing to anyone.
//
// This list does NOT skip the cross-site check below, which runs first. The
// scheduler sends no Origin header, so it passes that check on its own.
const PUBLIC = ["/login", "/api/auth", "/privacy", "/api/digest/run", "/api/invoice-review/run"];

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  // 0. CROSS-SITE CHECK — before anything else, including PUBLIC.
  //
  // The session cookie is SameSite=None so it works inside the Chrome side
  // panel, which switches off the browser's own CSRF protection for the whole
  // app. Nothing replaced it until 2026-09-14 (finding C-2): any page a
  // signed-in person visited could POST to /api/code, /api/delete-line or
  // /api/pave with their cookie attached, and the write reached the live
  // JobTread org. See src/lib/origin.ts for the full reasoning.
  //
  // Reads are untouched, so nothing about page loading changes. The side panel
  // is untouched too: it frames the app's own pages, so their fetches are
  // same-origin.
  if (
    !isSameSiteRequest(
      req.method,
      req.headers.get("origin"),
      req.headers.get("host"),
      process.env.COMPANION_ALLOWED_ORIGINS,
    )
  ) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  const viewId = viewIdForPath(pathname); // null = ungated route (home, etc.)

  // Deny access to a gated view the caller isn't allowed: 403 for APIs, and for
  // pages bounce to home (which self-filters to what they can see).
  const forbidden = () =>
    isApi
      ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
      : NextResponse.redirect(new URL("/", req.nextUrl));

  const unauthenticated = () => {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  };

  // 1. Google session (Auth.js) — enforce per-view access from the token.
  if (req.auth?.user) {
    // A session the periodic membership re-check marked dead: this person was
    // removed from the team in /admin. Treat it as no session at all, so they
    // land on /login, where signing in re-tests the allowlist and refuses them.
    if (req.auth.user.revoked) return unauthenticated();

    if (!viewId) return NextResponse.next(); // ungated route
    const u = req.auth.user;
    const allowed = resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny, u.roleBase);
    return allowed.has(viewId) ? NextResponse.next() : forbidden();
  }

  // 2. No sign-in method configured at all => open (local dev), no gating.
  //
  // The shared-password fallback that used to sit here was retired 2026-09-14
  // (finding M-3). It carried no identity or role, so it could only ever reach
  // ungated routes; it had no limit on guessing attempts; and its cookie was a
  // plain unsalted hash of the password, good for thirty days. Everyone holds a
  // Google login now, which the code always said was the condition for removing
  // it. APP_PASSWORD is no longer read anywhere except as a last-resort signing
  // key — see sessionSecret() in src/auth.ts, and delete the variable.
  if (noAuthConfigured()) return NextResponse.next();

  return unauthenticated();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
