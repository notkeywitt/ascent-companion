import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

// Proxy to the Apps Script web app's historical-cost-import actions
// (HistoricalCostImport.js). Apps Script holds the Sheets + JobTread-write
// grants; the Assistant is UI only — same pattern as /api/tracking-sheet.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET (= SYNC_TRIGGER_SECRET)
//
//   POST { op:"preview", url, jtJobId, startMonth?, startYear?, endMonth, endYear }
//   POST { op:"create",  url, jtJobId, startMonth?, startYear?, endMonth, endYear }
//
// This walks a tracking sheet's full history AND queries JobTread for every
// vendor-bill cost item on the job across that same range, so it can run tens
// of seconds on an old, heavily-billed job.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACTION_FOR_OP: Record<string, string> = {
  preview: "historicalCostPreview",
  create: "historicalCostCreate",
};

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const op = String(body.op || "");
  const action = ACTION_FOR_OP[op];
  if (!action) {
    return NextResponse.json(
      { error: `Unknown op "${op}" — expected one of ${Object.keys(ACTION_FOR_OP).join(", ")}.` },
      { status: 400 },
    );
  }

  const url = String(body.url || "").trim();
  if (!url) return NextResponse.json({ error: "A tracking sheet URL is required." }, { status: 400 });

  const jtJobId = String(body.jtJobId || "").trim();
  if (!jtJobId) return NextResponse.json({ error: "A job is required." }, { status: 400 });

  const endMonth = Number(body.endMonth);
  const endYear = Number(body.endYear);
  if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) {
    return NextResponse.json({ error: "A valid end month (1-12) is required." }, { status: 400 });
  }
  if (!Number.isInteger(endYear) || endYear < 2000 || endYear > 2100) {
    return NextResponse.json({ error: "A valid end year is required." }, { status: 400 });
  }

  const hasStart = body.startMonth !== undefined && body.startMonth !== null && body.startMonth !== "";
  const startMonth = hasStart ? Number(body.startMonth) : null;
  const startYear = hasStart ? Number(body.startYear) : null;
  if (hasStart && (!Number.isInteger(startMonth) || startMonth! < 1 || startMonth! > 12 || !Number.isInteger(startYear))) {
    return NextResponse.json({ error: "Start month/year, if given, must both be valid." }, { status: 400 });
  }

  const res = await callAppsScript<Record<string, unknown>>(
    {
      action,
      url,
      jtJobId,
      startMonth,
      startYear,
      endMonth,
      endYear,
      dryRun: body.dryRun === true,
    },
    // Pages a whole date range of JobTread cost items before writing. Give up
    // just under this route's maxDuration (120s) so a stall returns a readable
    // 504 instead of an opaque platform timeout.
    { timeoutMs: 110_000 },
  );
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  const b = res.data!;
  if (b.ok !== true) {
    return NextResponse.json(
      { error: String(b.error || "The historical-cost action failed."), ...b },
      { status: 502 },
    );
  }
  return NextResponse.json(b);
}
