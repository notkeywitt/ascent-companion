/**
 * GET → which build the server is running right now: `{ sha, message, page }`.
 *
 * The "update ready" banner (src/components/NewVersionNotice.tsx) polls this and
 * compares `sha` with the build frozen into its own bundle. A tab opened before
 * a deploy holds the old bundle, but this request reaches the newest
 * deployment, so a difference means a newer build is live.
 *
 * `?since=<the tab's sha>` also names `page`: the page with the most edited
 * lines in the commits newer than that build (src/lib/buildChanges.mjs), or null.
 * The banner's Refresh button opens it.
 *
 * Needs a session (the middleware checks it) but no role: it returns commit
 * hashes, a subject line and a route, nothing else. Never cached.
 */
import { NextRequest, NextResponse } from "next/server";

import { topPageSince } from "@/lib/buildChanges.mjs";

export const dynamic = "force-dynamic";

function frozenChanges(): unknown {
  try {
    return JSON.parse(process.env.APP_BUILD_CHANGES || "[]");
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since") || "";
  return NextResponse.json(
    {
      sha: process.env.APP_BUILD_SHA || "",
      message: process.env.APP_BUILD_MESSAGE || "",
      page: topPageSince(frozenChanges(), since),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
