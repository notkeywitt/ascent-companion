import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy to the Apps Script full-sync web app (runFullJtSync): kicks the entire
// hourly JT→sheets/Drive sync flow immediately. The route sits behind the
// app's auth middleware; the shared secret stays server-side in env vars.
//
// Env:
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
// POST /api/jt-sync            → queue the sync (returns in ~1s)
// POST /api/jt-sync {wait:true}→ run inline and return the step summary
//                                (Apps Script may take minutes; only use where
//                                the platform timeout allows it)
export async function POST(req: NextRequest) {
  let wait = false;
  try {
    const body = await req.json();
    wait = body?.wait === true;
  } catch {
    // empty body is fine — default to queued mode
  }

  // No action field — the bare payload is the full-sync kick, which writes, so
  // it is never retried.
  return callAppsScriptResponse({ wait });
}
