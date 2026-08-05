import { NextRequest, NextResponse } from "next/server";

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
      return { data: JSON.parse(text) as Record<string, unknown>, status: 200 };
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

  const res = await callAppsScript({
    action,
    url,
    jtJobId,
    startMonth,
    startYear,
    endMonth,
    endYear,
    dryRun: body.dryRun === true,
  });
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
