import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

const PUBLIC = ["/login", "/api/auth", "/api/login", "/privacy"];

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // 1. Google session (Auth.js).
  if (req.auth?.user) return NextResponse.next();

  // 2. Shared-password fallback (transition period).
  const pw = process.env.APP_PASSWORD;
  if (pw) {
    const cookie = req.cookies.get(AUTH_COOKIE)?.value;
    if (cookie && cookie === (await tokenFor(pw))) return NextResponse.next();
  }

  // 3. Neither auth configured => open (local dev).
  if (!process.env.AUTH_GOOGLE_ID && !pw) return NextResponse.next();

  // Otherwise block.
  if (pathname.startsWith("/api/")) {
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
