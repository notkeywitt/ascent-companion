import { NextRequest, NextResponse } from "next/server";

// Proxy to the Apps Script web app's per-project tracking-sheet actions
// (TrackingSheets.js). Apps Script holds the Sheets grants — the Assistant is UI
// only — so the shared secret stays server-side, same as /api/tools.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET (= SYNC_TRIGGER_SECRET)
//
//   GET                                    → { ok, jobs:[{id,label,jtJobId,url}],
//                                              defaultMonth, defaultYear }
//   POST { op:"sync",     projectId, month, year, dryRun? }
//   POST { op:"finalize", projectId, month, year, dryRun? }
//
// The sync pages a whole month of JobTread cost items and then writes to the
// project's own spreadsheet, so it can run tens of seconds — hence the extended
// function timeout (matches /api/needs-project and /api/email).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACTION_FOR_OP: Record<string, string> = {
  sync: "syncTrackingSheet",
  finalize: "finalizeTrackingSheet",
};

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    // Apps Script web apps answer via a 302 to a one-time content URL and always
    // report HTTP 200 there — success/failure is the "ok" field in the body.
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

export async function GET() {
  const res = await callAppsScript({ action: "listTrackingSheetJobs" });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  const b = res.data!;
  if (b.ok !== true) {
    return NextResponse.json(
      { error: String(b.error || "Apps Script rejected the request.") },
      { status: 502 },
    );
  }
  return NextResponse.json(b);
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

  const projectId = String(body.projectId || "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "A project is required." }, { status: 400 });
  }

  const month = Number(body.month);
  const year = Number(body.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "A billing month (1-12) is required." }, { status: 400 });
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "A billing year is required." }, { status: 400 });
  }

  const res = await callAppsScript({
    action,
    projectId,
    month,
    year,
    dryRun: body.dryRun === true,
  });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  const b = res.data!;
  if (b.ok !== true) {
    // Apps Script reports its own failures in the body, not the status code.
    return NextResponse.json(
      { error: String(b.error || "The tracking-sheet action failed.") },
      { status: 502 },
    );
  }
  return NextResponse.json(b);
}
