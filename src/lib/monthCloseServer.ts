/**
 * The month close, server side: one sheet's plan, and the move of the sheets'
 * month. Used by `/api/month-close` (the preview, "close the rest") and by
 * `/api/tracking-sheet` (which refuses a sync or finalize the rules forbid).
 * Rules: src/lib/monthClose.ts.
 *
 * Every Apps Script call here is a read or a dry run, except `advanceSheets`,
 * which stores the sheets' month (op `setTrackingPeriod`). That writes no sheet.
 */
import { callAppsScript } from "@/lib/appsScript";
import { listMonthActions, recordMonthAction } from "@/lib/monthActions";
import { checkLaborMonth, nextMonth, planSheet, type FinalizeDryRun, type LaborMonthCheck, type SheetPlan } from "@/lib/monthClose";
import type { Grid } from "@/lib/invoiceReview/sheetCompare";

export interface SheetJob {
  id: string;
  label: string;
  jtJobId: string;
  url: string;
}

export interface SheetList {
  jobs: SheetJob[];
  /** ProjectIDs whose sheet is wired to more than one job. */
  shared: Set<string>;
  /** The sheets' month, "YYYY-MM". */
  sheetsYm: string;
  paused: boolean;
}

/** The Next cache tag on /api/tracking-sheet's job list, which holds the sheets' month. */
export const SHEET_JOBS_TAG = "tracking-sheet-jobs";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The wired sheets, read fresh from Apps Script. */
export async function readSheetList(): Promise<SheetList> {
  const list = await callAppsScript<Record<string, unknown>>({ action: "listTrackingSheetJobs" });
  if (list.error) throw new Error(list.error);
  const b = list.data!;
  if (b.ok !== true) throw new Error(String(b.error || "Apps Script rejected the request."));
  const shared = new Set<string>();
  for (const s of (b.shared as { projects?: { projectId: string }[] }[]) ?? []) {
    for (const p of s.projects ?? []) shared.add(String(p.projectId));
  }
  return {
    jobs: ((b.jobs as SheetJob[]) ?? []).filter((j) => j.id && j.url),
    shared,
    sheetsYm: `${b.defaultYear}-${String(b.defaultMonth).padStart(2, "0")}`,
    paused: (b.sync as { paused?: boolean } | undefined)?.paused === true,
  };
}

export interface SheetRead {
  subVendor: Grid;
  labor: Grid;
}

export interface OneSheetPlan {
  plan: SheetPlan;
  labor: LaborMonthCheck;
  dry: FinalizeDryRun | null;
  read: SheetRead | null;
}

/** One sheet's plan for billing month `ym`: a read and a finalize dry run. Writes nothing. */
export async function planOneSheet(job: SheetJob, ym: string, shared: boolean): Promise<OneSheetPlan> {
  const [year, month] = ym.split("-").map(Number);
  const [read, dry] = await Promise.all([
    callAppsScript<Record<string, unknown>>({ action: "readTrackingSheet", jtJobId: job.jtJobId }, { retry: true, timeoutMs: 60_000 })
      .then((r) => {
        if (r.error || r.data?.ok !== true) throw new Error(r.error || String(r.data?.error ?? "no answer"));
        return { subVendor: (r.data.subVendor as Grid) ?? [], labor: (r.data.labor as Grid) ?? [] } as SheetRead;
      })
      .catch((e) => ({ error: errMsg(e) })),
    callAppsScript<Record<string, unknown>>(
      { action: "finalizeTrackingSheet", projectId: job.id, month, year, dryRun: true },
      { retry: true, timeoutMs: 60_000 },
    )
      .then((r) => {
        if (r.error || r.data?.ok !== true) throw new Error(r.error || String(r.data?.error ?? "no answer"));
        return r.data as FinalizeDryRun;
      })
      .catch((e) => ({ error: errMsg(e) })),
  ]);
  const readOk = !("error" in read);
  const dryOk = !("error" in dry);
  const labor = checkLaborMonth(readOk ? read.labor : null, ym);
  const plan = planSheet({
    shared,
    readError: readOk ? undefined : `The sheet could not be read: ${read.error}`,
    finalizeError: dryOk ? undefined : dry.error,
    dry: dryOk ? dry : undefined,
    labor,
  });
  return { plan, labor, dry: dryOk ? dry : null, read: readOk ? read : null };
}

/** ProjectIDs whose month `ym` is filed (the `finalize` stamp), with when. */
export async function filedStamps(ym: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const r of await listMonthActions(ym)) if (r.action === "finalize") out.set(r.scope, r.at);
  return out;
}

/** Stamp a sheet whose block already holds the month, so it counts as closed. */
export async function markFiled(projectId: string, ym: string, by: string, label: string): Promise<void> {
  await recordMonthAction("finalize", projectId, ym, by, `${label} (already filed)`);
}

/**
 * Move the sheets to the month after `ym` when `ym` is the sheets' month and
 * every wired sheet has it filed, or when `force` ("close the rest", which has
 * named the sheets it skipped). One month at a time. Returns the new month, or
 * "" when nothing moved.
 */
export async function advanceSheets(ym: string, opts: { force?: boolean } = {}): Promise<string> {
  const list = await readSheetList();
  if (list.sheetsYm !== ym) return "";
  if (!opts.force) {
    const filed = await filedStamps(ym);
    if (!list.jobs.length || list.jobs.some((j) => !filed.has(j.id))) return "";
  }
  const next = nextMonth(ym);
  const [year, month] = next.split("-").map(Number);
  const res = await callAppsScript<Record<string, unknown>>({ action: "setTrackingPeriod", month, year });
  if (res.error) throw new Error(res.error);
  if (res.data?.ok !== true) throw new Error(String(res.data?.error ?? "The sheets' month did not move."));
  return next;
}
