/**
 * The month close, server side: one sheet's plan, and the move of the sheets'
 * month. Used by `/api/month-close` (the preview, "close the rest") and by
 * `/api/tracking-sheet` (which refuses a sync or finalize the rules forbid).
 * Rules: src/lib/monthClose.ts.
 *
 * Every Apps Script call here is a read or a dry run, except `advanceSheets`,
 * which stores the sheets' month (op `setTrackingPeriod`), and the per-job
 * close and unlock at the end (`closeJobMonth`, `unlockJobMonth`), which write
 * one sheet and never JobTread.
 */
import { callAppsScript } from "@/lib/appsScript";
import { fileLaborReport } from "@/lib/laborReport";
import { deleteMonthAction, getMonthAction, listMonthActions, recordMonthAction } from "@/lib/monthActions";
import {
  checkLaborMonth,
  nextMonth,
  planSheet,
  sheetWriteBlocked,
  shortMonth,
  type FinalizeDryRun,
  type LaborMonthCheck,
  type SheetPlan,
} from "@/lib/monthClose";
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

// ---------------------------------------------------------------- one job, after the invoice went out

export interface JobCloseStep {
  label: string;
  state: "done" | "skipped";
  note: string;
}

const FILE_STEP = "File CURRENT INVOICE into the record block";
const ROLL_STEP = "Clear the sub/vendor bill list and point Labor at next month";

/** Apps Script's answer, or throw its transport error. */
async function sheetAction(payload: Record<string, unknown>, timeoutMs = 110_000): Promise<Record<string, unknown>> {
  const r = await callAppsScript<Record<string, unknown>>(payload, { timeoutMs });
  if (r.error) throw new Error(r.error);
  return r.data ?? {};
}

/**
 * Close one job's billing month after its invoice went out (Invoice Status,
 * "Close month"). Writes the tracking sheet and the companion DB, never
 * JobTread:
 *   1. file CURRENT INVOICE into the next record block (Apps Script finalize),
 *      unless the block already holds the month;
 *   2. while `ym` is the sheets' month: clear the sheet's sub/vendor bill list,
 *      point Labor A1 at next month's Labor Report (filed first when missing),
 *      and hold the 30-minute sync off the sheet;
 *   3. move the sheets' month when every sheet is filed;
 *   4. stamp `job-closed`, which locks the month in the app.
 * A broken sheet throws with its reasons, and nothing is locked.
 */
export async function closeJobMonth(
  jtJobId: string,
  ym: string,
  by: string,
): Promise<{ steps: JobCloseStep[]; advanced: string }> {
  const steps: JobCloseStep[] = [];
  let advanced = "";
  const list = await readSheetList();
  const job = list.jobs.find((j) => j.jtJobId === jtJobId);
  if (!job) {
    steps.push({ label: FILE_STEP, state: "skipped", note: "No tracking sheet on this job." });
  } else {
    const [year, month] = ym.split("-").map(Number);
    const filedAt = (await filedStamps(ym)).get(job.id);
    const one = await planOneSheet(job, ym, list.shared.has(job.id));
    if (one.plan.action === "skip") throw new Error(one.plan.reasons.join(" ") || "The sheet could not be filed.");
    if (one.plan.action === "filed") {
      if (!filedAt) await markFiled(job.id, ym, by, String(one.dry?.monthLabel ?? ""));
      steps.push({ label: FILE_STEP, state: "skipped", note: one.plan.reasons.join(" ") });
    } else {
      const why = sheetWriteBlocked(ym, list.sheetsYm, Boolean(filedAt));
      if (why) throw new Error(why);
      // ponytail: no sync first; the 30-minute push keeps CURRENT INVOICE current in the sheets' month.
      const f = await sheetAction({ action: "finalizeTrackingSheet", projectId: job.id, month, year, dryRun: false });
      if (f.ok !== true) throw new Error(String(f.error || "The sheet was not filed."));
      await recordMonthAction("finalize", job.id, ym, by, String(f.monthLabel ?? ""));
      steps.push({ label: FILE_STEP, state: "done", note: `Filed as "${f.monthLabel ?? ""}" at ${f.targetRange ?? ""}.` });
    }

    if (ym === list.sheetsYm) {
      const roll = () => sheetAction({ action: "rolloverTrackingSheet", projectId: job.id, month, year });
      let r = await roll();
      if (r.missingLabor === true) {
        const [ny, nm] = nextMonth(ym).split("-").map(Number);
        await fileLaborReport(ny, nm, by);
        r = await roll();
      }
      if (r.ok !== true) throw new Error(String(r.error || "The sheet did not move to the next month."));
      steps.push({
        label: ROLL_STEP,
        state: "done",
        note: `${r.clearedRows ?? 0} bill rows cleared. Labor A1 now reads "${r.laborNow || r.laborTitle}".`,
      });
    } else {
      steps.push({ label: ROLL_STEP, state: "skipped", note: `The sheets are already on ${shortMonth(list.sheetsYm)}.` });
    }
    advanced = await advanceSheets(ym);
  }
  await recordMonthAction("job-closed", jtJobId, ym, by);
  steps.push({ label: "Lock the month in the app", state: "done", note: "" });
  return { steps, advanced };
}

/**
 * Unlock: the app may edit the month again, and the 30-minute sync may write
 * the sheet again. The record block stays filed; the bill list and Labor A1
 * are not put back.
 */
export async function unlockJobMonth(jtJobId: string, ym: string): Promise<void> {
  await deleteMonthAction("job-closed", jtJobId, ym);
  const job = (await readSheetList()).jobs.find((j) => j.jtJobId === jtJobId);
  if (!job) return;
  const r = await sheetAction({ action: "reopenTrackingSheet", projectId: job.id }, 30_000);
  if (r.ok !== true) throw new Error(String(r.error || "The sheet sync was not resumed."));
}

/** Jobs closed for `ym`: jtJobId → when and by whom. */
export async function closedJobs(ym: string): Promise<Record<string, { at: string; by: string }>> {
  const out: Record<string, { at: string; by: string }> = {};
  for (const r of await listMonthActions(ym)) if (r.action === "job-closed") out[r.scope] = { at: r.at, by: r.by };
  return out;
}

/** Is this job's month locked? */
export async function jobMonthClosed(jtJobId: string, ym: string): Promise<boolean> {
  return (await getMonthAction("job-closed", jtJobId, ym)) !== undefined;
}
