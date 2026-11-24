import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { noAuthConfigured } from "@/lib/authMode";
import { isSameSiteRequest } from "@/lib/origin";
import { isPublicPath, isSignedInApi, resolveAllowedViews, viewIdForPath } from "@/lib/views";

// The public routes (no session; each authenticates itself) and the API routes
// any signed-in role may call both live in src/lib/views.ts, beside the views,
// so one test (src/lib/apiGate.test.ts) can check every route has a gate.

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

  if (isPublicPath(pathname)) {
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

    if (!viewId) {
      // An API route on no view is closed unless SIGNED_IN_API names it
      // (security item M-1, 2026-11-24). A page on no view (Today, Help…)
      // stays open: pages hold no data of their own.
      if (isApi && !isSignedInApi(pathname)) return forbidden();
      return NextResponse.next();
    }
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

// The install icons and the manifest skip the middleware. Chrome on iPhone and
// Android fetch them WITHOUT the session cookie when a page is added to the home
// screen, so the sign-in redirect handed back the /login HTML instead of a PNG
// and the home screen showed a blank tile. They hold the logo and app name only.
// widget-install.sh and AscentWidget.zip (2026-11-11, owner) are the Mac desktop
// widget's installer, fetched by `curl` in Terminal, which carries no session.
// They hold a web-view shell for /widget and no data or secret; the page it
// shows still needs a Google sign-in.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|apple-icon.png|icon.png|icon-192.png|icon-512.png|manifest.webmanifest|widget-install.sh|AscentWidget.zip).*)",
  ],
};
