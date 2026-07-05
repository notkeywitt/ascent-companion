import { NextResponse } from "next/server";

// Public diagnostic. The Google client ID is NOT secret (it's visible in the
// OAuth URL), so we show it in full to compare against Google Cloud. Secret is
// only reported by length + whitespace, never its value.
export function GET() {
  const id = process.env.AUTH_GOOGLE_ID ?? "";
  const secret = process.env.AUTH_GOOGLE_SECRET ?? "";
  return NextResponse.json({
    googleClientId: id, // compare this EXACTLY to the Client ID in Google Cloud
    clientIdLength: id.length,
    clientIdHasWhitespace: id !== id.trim(),
    googleSecretSet: Boolean(secret),
    secretLength: secret.length, // Google secrets are ~35 chars, start "GOCSPX-"
    secretHasWhitespace: secret !== secret.trim(),
    authSecretSet: Boolean(process.env.AUTH_SECRET),
    appPasswordSet: Boolean(process.env.APP_PASSWORD),
    allowedEmailCount: (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .filter((s) => s.trim()).length,
  });
}
