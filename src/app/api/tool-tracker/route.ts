import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";

// Proxy to the Apps Script web app's tool-tracker actions. Apps Script holds the
// Google Sheets grant (it reads/writes the Project Database "Tools" tab); the
// Assistant has no Sheets client, so it asks over the same shared-secret web app
// used by /api/email and /api/employees. The secret stays server-side.
//
// Env (shared with /api/email, /api/employees):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
//   GET  → { ok, tools:[{id, name, type, condition, location, locationLabel,
//            photoUrl}], projects:[{id, label, lat, lng}] }   (page bootstrap)
//   POST { toolId, projectId } → { ok, tool, locationLabel }  (record a scan)
//
// LastScanEmail is taken from the signed-in Google session server-side (never
// the client body), so a scan is attributed to whoever is actually logged in.
export const dynamic = "force-dynamic";

export async function GET() {
  // One combined Apps Script action instead of two separate POSTs — half the network
  // round-trips + cold-starts for the page bootstrap. Apps Script caches both halves.
  const res = await callAppsScript({ action: "toolsBootstrap" });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  const b = res.data as { ok?: boolean; error?: string; tools?: unknown; projects?: unknown };
  if (b?.ok === false) return NextResponse.json(b, { status: 200 });

  return NextResponse.json(
    { ok: true, tools: b?.tools ?? [], projects: b?.projects ?? [] },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // Attribute the scan to the signed-in user, not to anything the client sends.
  const session = await auth();
  const lastScanEmail = session?.user?.email ?? "";

  const result = await callAppsScript({
    action: "updateToolLocation",
    toolId: body.toolId,
    projectId: body.projectId,
    lastScanEmail,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}
