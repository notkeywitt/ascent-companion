import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// A tracking sheet's Contract Estimate as a JobTread budget import CSV
// (appscript BudgetImport.js). Read-only on both sides: Apps Script reads the
// sheet and the org's cost codes, and the office imports the file on the job's
// Budget tab themselves.
//
//   GET                → { ok, jobs:[{id,label,jtJobId,url}], … }  the projects wired to a sheet
//   POST { projectId } → { ok, fileName, csv, items, total, sheetTotal, problems }
//
// Apps Script reports its own failures as { ok:false, error } in the body.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return callAppsScriptResponse({ action: "listTrackingSheetJobs" });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown };
  const projectId = String(body.projectId || "").trim();
  if (!projectId) return NextResponse.json({ error: "A project is required." }, { status: 400 });
  // One tracking sheet plus two pages of cost codes — seconds, but give Apps
  // Script room under this route's maxDuration.
  return callAppsScriptResponse({ action: "getBudgetImportCsv", projectId }, { timeoutMs: 55_000 });
}
