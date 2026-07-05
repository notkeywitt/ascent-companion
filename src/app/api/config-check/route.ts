import { NextResponse } from "next/server";

// Public diagnostic — presence of auth env vars only (NO secret values).
// The Google client ID isn't sensitive (it's public during OAuth); its tail is
// shown to confirm it ends in ".apps.googleusercontent.com".
export function GET() {
  const id = process.env.AUTH_GOOGLE_ID ?? "";
  return NextResponse.json({
    googleClientIdSet: Boolean(id),
    googleClientIdTail: id.slice(-30),
    googleSecretSet: Boolean(process.env.AUTH_GOOGLE_SECRET),
    authSecretSet: Boolean(process.env.AUTH_SECRET),
    appPasswordSet: Boolean(process.env.APP_PASSWORD),
    allowedEmailCount: (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .filter((s) => s.trim()).length,
  });
}
