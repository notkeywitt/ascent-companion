import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.json({ ok: true }); // auth disabled

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if ((body.password ?? "") !== password) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // SameSite=None so the cookie is sent when the app runs inside the Chrome
  // side-panel iframe (a third-party context); requires Secure (prod = HTTPS).
  res.cookies.set(AUTH_COOKIE, await tokenFor(password), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
