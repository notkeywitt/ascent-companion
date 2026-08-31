import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";
import { resolveAllowedViews, viewIdForPath } from "@/lib/views";

// Routes that skip the session check entirely. Everything here authenticates
// ITSELF — /api/digest/run is called by the daily scheduler, which carries no
// Google session, so it verifies a cron bearer secret (or an admin session) in
// its own handler. Being listed here removes the session requirement, NOT the
// authorization; don't add a route that has no credential of its own.
const PUBLIC = ["/login", "/api/auth", "/api/login", "/privacy", "/api/digest/run"];

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
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

  // 1. Google session (Auth.js) — enforce per-view access from the token.
  if (req.auth?.user) {
    if (!viewId) return NextResponse.next(); // ungated route
    const u = req.auth.user;
    const allowed = resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny, u.roleBase);
    return allowed.has(viewId) ? NextResponse.next() : forbidden();
  }

  // 2. Shared-password fallback (transition period). Carries NO identity/role,
  //    so it can reach ungated routes only — a role-gated view is forbidden.
  //    Retire APP_PASSWORD in production once everyone has a Google login.
  const pw = process.env.APP_PASSWORD;
  if (pw) {
    const cookie = req.cookies.get(AUTH_COOKIE)?.value;
    if (cookie && cookie === (await tokenFor(pw))) {
      return viewId ? forbidden() : NextResponse.next();
    }
  }

  // 3. Neither auth configured => open (local dev), no gating.
  if (!process.env.AUTH_GOOGLE_ID && !pw) return NextResponse.next();

  // Otherwise not authenticated at all.
  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
