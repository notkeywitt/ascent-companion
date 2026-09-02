import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getOrgTimeEntriesForMonth } from "@/lib/jobtread";
import { QB_LABOR_COLUMN_TYPES, buildQbLaborRows, laborReportTitle } from "@/lib/qbLaborCsv";

/**
 * The monthly Labor Report — one Google Sheet per month in the Drive Labor
 * folder, built out of JobTread.
 *
 * POST { ym: "YYYY-MM" } → create or update "<Month> '<YY> Labor".
 *
 * ## What it replaces
 *
 * Labor Review used to download ONE job's month as a QuickBooks-format CSV, and
 * the office separately hand-exported the company-wide month out of QuickBooks
 * Time into the Drive Labor folder. This does the second job from JobTread: the
 * whole ORG's month, in the same 23-column shape as the sheets already filed
 * there, written straight into the same folder under the same naming
 * convention. The month is one file forever — re-running overwrites it in place,
 * so the URL a person bookmarked keeps working.
 *
 * ## The split
 *
 * The columns are built HERE (`buildQbLaborRows`) and only filed by Apps
 * Script. One definition of the export shape, in the repo that also owns
 * /labor-import's reader, so the round trip cannot drift.
 *
 * ## Read-only against JobTread
 *
 * Nothing is written to JobTread — the only write is the Drive sheet, and it is
 * a mirror of what JobTread already holds, so this cannot fight the mirror. It
 * needs no `writesEnabled()` gate for that reason.
 *
 * ⚠️ The Labor folder is the input to `importLaborFromDrive` (Apps Script), which
 * pulls every sheet in it into the Project Database "Labor" tab. Writing here
 * feeds that importer — which is the intent, and which is why the report must
 * overwrite one file per month rather than add a file per run.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  // Attribution comes from the session, never the body — same rule as /api/code.
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { ym?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const m = /^(\d{4})-(\d{2})$/.exec((body.ym ?? "").trim());
  if (!m) return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  }

  try {
    const entries = await getOrgTimeEntriesForMonth(getPaveConfig(), year, month);
    if (entries.length === 0) {
      return NextResponse.json(
        { error: `JobTread has no time entries in ${laborReportTitle(year, month).replace(/ Labor$/, "")}.` },
        { status: 404 },
      );
    }

    const rows = buildQbLaborRows(entries);
    const title = laborReportTitle(year, month);

    // A WRITE, so never retried: a second attempt after a lost response would
    // re-file the same month. It is idempotent by construction (one file per
    // month, overwritten in place), but leaving retry off keeps the rule in
    // appsScript.ts — unknown action ⇒ assume it writes — unqualified.
    const r = await callAppsScript<{
      ok: boolean;
      error?: string;
      url?: string;
      fileId?: string;
      created?: boolean;
      rows?: number;
    }>(
      // columnTypes rides along so the sheet gets real numbers and dates. The
      // tracking sheets QUERY the report with sum(hours) and min/max(date), and
      // a text column fails that outright — see QB_LABOR_COLUMN_TYPES.
      { action: "writeLaborReport", title, rows, columnTypes: [...QB_LABOR_COLUMN_TYPES] },
      { timeoutMs: 240_000 },
    );

    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
    if (!r.data?.ok) {
      return NextResponse.json(
        { error: r.data?.error ?? "Apps Script could not write the Labor Report." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      title,
      url: r.data.url,
      fileId: r.data.fileId,
      created: Boolean(r.data.created),
      entries: entries.length,
      jobs: new Set(entries.map((e) => e.jobId).filter(Boolean)).size,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
