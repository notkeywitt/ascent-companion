import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

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

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    // Apps Script answers via a 302 to a one-time content URL, always HTTP 200
    // there — success/failure is the `ok` field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as unknown, status: 200 };
    } catch {
      return {
        error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        status: 502,
      };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error", status: 502 };
  }
}

export async function GET() {
  const [tools, projects] = await Promise.all([
    callAppsScript({ action: "listTools" }),
    callAppsScript({ action: "listToolProjects" }),
  ]);
  if (tools.error) return NextResponse.json({ error: tools.error }, { status: tools.status });
  if (projects.error) return NextResponse.json({ error: projects.error }, { status: projects.status });

  const t = tools.data as { ok?: boolean; error?: string; tools?: unknown };
  const p = projects.data as { ok?: boolean; error?: string; projects?: unknown };
  if (t?.ok === false) return NextResponse.json(t, { status: 200 });
  if (p?.ok === false) return NextResponse.json(p, { status: 200 });

  return NextResponse.json(
    { ok: true, tools: t?.tools ?? [], projects: p?.projects ?? [] },
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
