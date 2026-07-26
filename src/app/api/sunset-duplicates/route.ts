import { NextResponse } from "next/server";

// GET /api/sunset-duplicates
// Runs the Apps Script Sunset duplicate-bill scan and returns its structured
// findings for inline display on the Sunset Statements page. Read-only — the scan
// queries JobTread and writes nothing. Kept as its own route (a full org-wide JT
// scan) so it never slows the statements list.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 60; // org-wide JT vendorBill scan, paged

async function callAppsScript(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    throw new Error("APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow",
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.ok === false) throw new Error(String(json.error ?? "Apps Script reported an error."));
  return json;
}

export async function GET() {
  try {
    const resp = await callAppsScript({ action: "sunsetDuplicates" });
    return NextResponse.json(resp);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
