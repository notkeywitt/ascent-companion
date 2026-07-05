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
  res.cookies.set(AUTH_COOKIE, await tokenFor(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
