import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

// Public paths (no auth needed).
const PUBLIC = ["/login", "/api/login"];

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  // Auth is only enforced when a password is configured (so local dev is open).
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await tokenFor(password))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
