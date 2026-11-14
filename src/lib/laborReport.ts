/**
 * The monthly Labor Report — one Google Sheet per month in the Drive Labor
 * folder, built out of JobTread. Server-only.
 *
 * `fileLaborReport` is the whole job: read the org's month, shape the 23
 * QuickBooks Time columns (`qbLaborCsv.ts`), hand them to Apps Script
 * `writeLaborReport` (one file per month, overwritten in place), stamp the run.
 * `/api/labor-report` calls it for the "Run now" link; the office labor routes
 * (/api/time-entry, /api/time-entry/create, /api/labor-review) call
 * `refileLaborReportAfterWrite` inside `after()`, so a labor fix reaches the
 * sheet without a button. The crew's clock routes do not: one Drive rewrite
 * per punch is waste, and the open month is refiled when the office edits it.
 *
 * Writes nothing to JobTread, and the sheet mirrors what JobTread holds, so it
 * cannot fight the hourly mirror. The Labor folder feeds `importLaborFromDrive`
 * and the tracking sheets QUERY the file, which is why it must overwrite one
 * file per month rather than add one per run.
 */
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig } from "@/lib/config";
import { getOrgTimeEntriesForMonth, jtIsoToOrgLocal } from "@/lib/jobtread";
import { getMonthAction, recordMonthAction } from "@/lib/monthActions";
import { QB_LABOR_COLUMN_TYPES, buildQbLaborRows, laborReportTitle } from "@/lib/qbLaborCsv";

export class LaborReportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface LaborReportResult {
  title: string;
  url?: string;
  fileId?: string;
  created: boolean;
  entries: number;
  jobs: number;
}

/** File the month. Throws LaborReportError with the status a route should send. */
export async function fileLaborReport(year: number, month: number, by: string): Promise<LaborReportResult> {
  const entries = await getOrgTimeEntriesForMonth(getPaveConfig(), year, month);
  const title = laborReportTitle(year, month);
  if (entries.length === 0) {
    throw new LaborReportError(`JobTread has no time entries in ${title.replace(/ Labor$/, "")}.`, 404);
  }
  const rows = buildQbLaborRows(entries);
  // A WRITE, so never retried: idempotent by construction (one file per month),
  // but leaving retry off keeps the rule in appsScript.ts unqualified.
  const r = await callAppsScript<{
    ok: boolean;
    error?: string;
    url?: string;
    fileId?: string;
    created?: boolean;
  }>(
    // columnTypes rides along so the sheet gets real numbers and dates — the
    // tracking sheets QUERY it with sum(hours) and min/max(date).
    { action: "writeLaborReport", title, rows, columnTypes: [...QB_LABOR_COLUMN_TYPES] },
    { timeoutMs: 240_000 },
  );
  if (r.error) throw new LaborReportError(r.error, r.status);
  if (!r.data?.ok) {
    throw new LaborReportError(r.data?.error ?? "Apps Script could not write the Labor Report.", 502);
  }
  await recordMonthAction("labor-report", "", `${year}-${String(month).padStart(2, "0")}`, by);
  return {
    title,
    url: r.data.url,
    fileId: r.data.fileId,
    created: Boolean(r.data.created),
    entries: entries.length,
    jobs: new Set(entries.map((e) => e.jobId).filter(Boolean)).size,
  };
}

/** The calendar month a JobTread instant falls in, org-local: "2026-09". */
export function ymOfJtInstant(iso: string | null | undefined): string {
  return jtIsoToOrgLocal(iso ?? "").slice(0, 7);
}

/** How long a labor write waits for the next one before it refiles the month. */
const DEBOUNCE_MS = 60_000;

/**
 * Refile each month after a burst of labor writes — call inside `after()`.
 *
 * Debounced across serverless invocations through the `labor-report-due`
 * stamp: every write stamps its own instant, waits, and refiles only if no
 * later write has stamped since. The last write of a burst does the one
 * refile. Never throws: the labor write already happened, and the report is a
 * mirror of it.
 */
export async function refileLaborReportAfterWrite(yms: Iterable<string>, by: string): Promise<void> {
  const months = [...new Set([...yms].filter((ym) => /^\d{4}-\d{2}$/.test(ym)))];
  if (months.length === 0) return;
  const at = new Date().toISOString();
  await Promise.all(months.map((ym) => recordMonthAction("labor-report-due", "", ym, by, at)));
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  for (const ym of months) {
    try {
      const due = await getMonthAction("labor-report-due", "", ym);
      if (due && due.note !== at) continue; // a later write owns the refile
      const [y, m] = ym.split("-").map(Number);
      await fileLaborReport(y, m, by);
    } catch (e) {
      console.error("[laborReport] refile after write failed", ym, e);
    }
  }
}
