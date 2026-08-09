import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

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
  // Pins which month the hourly all-projects sync keeps in CURRENT INVOICE.
  // Global, not per-project — it takes month/year and ignores projectId.
  setPeriod: "setTrackingPeriod",
};

export async function GET() {
  const res = await callAppsScript<Record<string, unknown>>({ action: "listTrackingSheetJobs" });
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

  // setPeriod is org-wide — it pins the month for EVERY wired sheet, so it is
  // the one op that carries no project.
  const projectId = String(body.projectId || "").trim();
  if (!projectId && op !== "setPeriod") {
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

  const res = await callAppsScript<Record<string, unknown>>(
    {
      action,
      projectId,
      month,
      year,
      dryRun: body.dryRun === true,
    },
    // A month of cost items, then a write to the project's own spreadsheet —
    // tens of seconds. Stay just under this route's maxDuration (120s).
    { timeoutMs: 110_000 },
  );
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
