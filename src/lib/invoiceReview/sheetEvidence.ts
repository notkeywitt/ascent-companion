/**
 * The legacy clients' Google Tracking Sheets, read and compared in code.
 *
 * Claude Code used to read each sheet's cells with the Google Sheets tool and
 * post them back. That was most of the monthly check's run time. The cells now
 * arrive through the Apps Script action `readTrackingSheet`, and
 * `compareTrackingSheet` (sheetCompare.ts) does the arithmetic as before.
 *
 * Best-effort: a sheet that cannot be read becomes a warning, never a finding
 * and never a failed review.
 */
import { callAppsScript } from "@/lib/appsScript";
import {
  getBillLinesForJob,
  getJobBillsForMonth,
  getJobTimeEntriesForMonth,
  type PaveConfig,
} from "@/lib/jobtread";

import {
  compareTrackingSheet,
  findInvoiceColumns,
  totalJtLabor,
  totalJtLines,
  type Grid,
  type SheetCheckResult,
} from "./sheetCompare";

export interface SheetEvidence {
  jobId: string;
  label: string;
  url: string;
  result: SheetCheckResult;
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The 'Tracking Sheet' tab from row `firstRow` (7) down, cut into the parts
 * `compareTrackingSheet` takes: the three header rows, the code column, and the
 * LABOR / INVOICES columns of the CURRENT INVOICE block and the month's block.
 */
export function sliceMainTab(main: Grid, year: number, month: number) {
  const headers = main.slice(0, 3);
  const body = main.slice(3);
  const found = findInvoiceColumns(headers, year, month);
  const columns: Record<string, Grid> = {};
  for (const letter of [found.current.labor, found.current.invoices, found.month.labor, found.month.invoices]) {
    if (!letter || columns[letter]) continue;
    const c = colIndex(letter);
    columns[letter] = body.map((r) => [r?.[c] ?? ""]);
  }
  return { headers, codes: body.map((r) => [r?.[0] ?? ""]), columns };
}

export async function loadSheetEvidence(
  cfg: PaveConfig,
  year: number,
  month: number,
): Promise<{ sheets: SheetEvidence[]; warnings: string[] }> {
  const warnings: string[] = [];
  const list = await callAppsScript<Record<string, unknown>>({ action: "listTrackingSheetJobs" });
  if (list.error) {
    return { sheets: [], warnings: [`Tracking Sheets were not checked — the sheet list could not be read: ${list.error}`] };
  }
  const jobs = ((list.data?.jobs as Record<string, unknown>[]) ?? [])
    .map((j) => ({ jobId: String(j.jtJobId ?? ""), label: String(j.label ?? ""), url: String(j.url ?? "") }))
    .filter((j) => j.jobId && j.url);

  const sheets: SheetEvidence[] = [];
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const [read, bills, entries] = await Promise.all([
          // A read, safe to send twice.
          callAppsScript<Record<string, unknown>>(
            { action: "readTrackingSheet", jtJobId: job.jobId },
            { retry: true, timeoutMs: 60_000 },
          ),
          getJobBillsForMonth(cfg, job.jobId, year, month, true, true),
          getJobTimeEntriesForMonth(cfg, job.jobId, year, month),
        ]);
        if (read.error || !read.data?.ok) {
          throw new Error(read.error || String(read.data?.error ?? "no answer"));
        }
        const lines = await getBillLinesForJob(cfg, job.jobId, bills.map((b) => b.id));
        const main = (read.data.main as Grid) ?? [];
        const labor = (read.data.labor as Grid) ?? [];
        const firstRow = Number(read.data.mainFirstRow) || 7;
        sheets.push({
          ...job,
          result: compareTrackingSheet({
            year,
            month,
            jt: totalJtLines(bills, lines),
            jtLabor: totalJtLabor(entries),
            subVendor: (read.data.subVendor as Grid) ?? [],
            labor: labor.length ? labor : undefined,
            ...(main.length ? sliceMainTab(main, year, month) : {}),
            firstRow: firstRow + 3,
          }),
        });
      } catch (e) {
        warnings.push(
          `${job.label}: the Tracking Sheet was not checked — ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }
    }),
  );
  // Every sheet failing is one cause (the Apps Script side is down or behind),
  // so it is one warning.
  if (!sheets.length && warnings.length > 1) {
    return { sheets, warnings: [`Tracking Sheets were not checked — ${warnings[0].split(" — ")[1] ?? "unknown error"}`] };
  }
  sheets.sort((a, b) => a.label.localeCompare(b.label));
  return { sheets, warnings };
}
