import { NextResponse } from "next/server";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

// GET /api/sunset-duplicates
// Runs the Apps Script Sunset duplicate-bill scan and returns its structured
// findings for inline display on the Sunset Statements page. Read-only — the scan
// queries JobTread and writes nothing. Kept as its own route (a full org-wide JT
// scan) so it never slows the statements list.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 60; // org-wide JT vendorBill scan, paged

export async function GET() {
  try {
    const resp = await callAppsScriptOrThrow(
      { action: "sunsetDuplicates" },
      // Org-wide paged JT scan; stay under this route's maxDuration (60s).
      { timeoutMs: 50_000 },
    );
    return NextResponse.json(resp);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
