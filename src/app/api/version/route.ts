/**
 * GET → which build the server is running right now: `{ sha, message }`.
 *
 * The "update ready" banner (src/components/NewVersionNotice.tsx) polls this and
 * compares `sha` with the build frozen into its own bundle. A tab opened before
 * a deploy holds the old bundle, but this request reaches the newest
 * deployment, so a difference means a newer build is live.
 *
 * Needs a session (the middleware checks it) but no role: it returns a commit
 * hash and a subject line, nothing else. Never cached.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      sha: process.env.APP_BUILD_SHA || "",
      message: process.env.APP_BUILD_MESSAGE || "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
