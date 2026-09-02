import { revalidateTag, unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { callAppsScript, callAppsScriptOrThrow } from "@/lib/appsScript";

// Stay just under this route's maxDuration (60s) so a stall returns a readable
// 504 rather than an opaque platform timeout.
const TIMEOUT = { timeoutMs: 50_000 };
// Proxy to the Apps Script web app's tool-management actions. Apps Script holds
// the Google Sheets + Drive grants; the Assistant is UI only. Same shared-secret
// web app used by /api/tool-tracker and /api/employees (secret stays server-side).
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET (= SYNC_TRIGGER_SECRET)
//
//   GET   → { ok, tools:[...full fields...], projects:[{id,label,lat,lng}],
//            conditions:[...], toolGroups:[...] }   (Condition / Tool group dropdown options)
//   PATCH { toolId, fields } → { ok, tool, changed }        (edit text fields)
//   POST  { toolId, imageBase64, mimeType } → { ok, tool }  (replace photo)
//   PUT   { toolId, fields } → { ok, tool }                 (register a new tool)
//
// PUT (createTool) is for scanning a sticker that isn't in the inventory yet; the
// scan audit (LastScanEmail) is taken from the signed-in session, not the client.
// A phone photo (even downscaled) plus the Drive write is slower than a plain
// text edit, so allow a longer function timeout.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shared Data Cache tag for the tools bootstrap. Every write below drops it. */
const TOOLS_TAG = "tools";

interface ToolsBootstrap {
  ok?: boolean;
  error?: string;
  tools?: unknown;
  projects?: unknown;
  conditions?: unknown;
  toolGroups?: unknown;
}

const shape = (b: ToolsBootstrap) => ({
  ok: true,
  tools: b?.tools ?? [],
  projects: b?.projects ?? [],
  conditions: b?.conditions ?? [],
  toolGroups: b?.toolGroups ?? [],
});

// One combined Apps Script action instead of two separate POSTs — half the network
// round-trips + cold-starts for the page bootstrap. Apps Script caches both halves.
const readBootstrap = () =>
  callAppsScriptOrThrow<ToolsBootstrap>({ action: "toolsBootstrap" }, TIMEOUT);

// Shared Data Cache over that call. The Apps Script hop is a POST→302→follow plus a
// script execution — about a second even warm — and the inventory is org-wide, so one
// shared entry is right for every viewer. Failures THROW (callAppsScriptOrThrow also
// throws on { ok:false }), so only a good payload is ever cached. Every write path in
// this file, and the scan in /api/tool-tracker, drops the tag, so an edit still shows
// on the next load rather than after the TTL.
const getCachedBootstrap = unstable_cache(readBootstrap, ["api-tools-bootstrap"], {
  revalidate: 60,
  tags: [TOOLS_TAG],
});

// GET /api/tools[?refresh=1] — `refresh=1` skips the cache and drops the entry.
export async function GET(req: NextRequest) {
  const forceFresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    if (forceFresh) {
      const fresh = await readBootstrap();
      revalidateTag(TOOLS_TAG); // so every other reader agrees with what we just read
      return NextResponse.json(shape(fresh), { status: 200 });
    }
    return NextResponse.json(shape(await getCachedBootstrap()), { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load tools." },
      { status: 502 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const result = await callAppsScript({ ...body, action: "updateTool" }, TIMEOUT);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidateTag(TOOLS_TAG); // the edit must show on the next bootstrap, not after the TTL
  return NextResponse.json(result.data, { status: 200 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const result = await callAppsScript({ ...body, action: "updateToolPhoto" }, TIMEOUT);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidateTag(TOOLS_TAG);
  return NextResponse.json(result.data, { status: 200 });
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Attribute the first scan (which registers the tool) to the signed-in user.
  const session = await auth();
  const lastScanEmail = session?.user?.email ?? "";

  const result = await callAppsScript({ ...body, action: "createTool", lastScanEmail }, TIMEOUT);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidateTag(TOOLS_TAG);
  return NextResponse.json(result.data, { status: 200 });
}
