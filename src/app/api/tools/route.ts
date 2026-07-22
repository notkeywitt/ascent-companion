import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

// Proxy to the Apps Script web app's tool-management actions. Apps Script holds
// the Google Sheets + Drive grants; the Assistant is UI only. Same shared-secret
// web app used by /api/tool-tracker and /api/employees (secret stays server-side).
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET (= SYNC_TRIGGER_SECRET)
//
//   GET   → { ok, tools:[...full fields...], projects:[{id,label,lat,lng}] }
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

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
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

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const result = await callAppsScript({ ...body, action: "updateTool" });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const result = await callAppsScript({ ...body, action: "updateToolPhoto" });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
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

  const result = await callAppsScript({ ...body, action: "createTool", lastScanEmail });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}
