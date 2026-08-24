import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

// Proxy to the Apps Script web app's historical-cost-import actions
// (HistoricalCostImport.js). Apps Script holds the Sheets + JobTread-write
// grants; the Assistant is UI only — same pattern as /api/tracking-sheet.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET (= SYNC_TRIGGER_SECRET)
//
//   POST { op:"preview", url, jtJobId }
//   POST { op:"create",  url, jtJobId, dryRun? }
//
// No date range: the sheet's "Total Previously Invoiced" column defines the
// period, and Apps Script cuts JobTread off at the end of that same billing
// period. This reads the whole tracking sheet AND pages every vendor-bill cost
// item plus every time entry on the job, so it can run tens of seconds on an
// old, heavily-billed job.
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

  const res = await callAppsScript<Record<string, unknown>>(
    {
      action,
      url,
      jtJobId,
      dryRun: body.dryRun === true,
    },
    // Pages every JobTread cost item and time entry before writing. Give up
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
