import { NextRequest, NextResponse } from "next/server";

import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig } from "@/lib/config";
import { getBillLinesForJob, getJobBillsForMonth, getJobTimeEntriesForMonth } from "@/lib/jobtread";
import { listMonthActions } from "@/lib/monthActions";
import {
  checkLaborMonth,
  closeProgress,
  isYm,
  planSheet,
  type FinalizeDryRun,
  type SheetPlan,
  type LaborMonthCheck,
} from "@/lib/monthClose";
import { readLabor, readSubVendor, totalJtLabor, totalJtLines, type Grid } from "@/lib/invoiceReview/sheetCompare";

/**
 * GET ?ym=YYYY-MM[&projectId=…] — the month close PREVIEW. Writes nothing.
 *
 * For each wired tracking sheet (or the one `projectId`): what the close would
 * do (copy into a block, leave a filed block, or skip a broken sheet), the
 * target block from a finalize dry run, the Labor tab's month check, and the
 * sheet's bills and labor beside JobTread's. Rules: src/lib/monthClose.ts.
 *
 * `ym` defaults to the sheets' month (the active period Apps Script holds).
 * Every Apps Script call here is a read or a dry run: `listTrackingSheetJobs`,
 * `readTrackingSheet`, `finalizeTrackingSheet` with dryRun. Gated with the
 * Tracking Sheets view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Job {
  id: string;
  label: string;
  jtJobId: string;
  url: string;
}

export interface MonthCloseRow {
  projectId: string;
  jtJobId: string;
  label: string;
  url: string;
  plan: SheetPlan;
  labor: LaborMonthCheck;
  block: { label: string; range: string; labelCell: string; blocksRemaining: number | null } | null;
  /** The sheet now. Null when it could not be read. */
  sheet: { bills: number; laborHours: number; laborCost: number } | null;
  /** JobTread for the month. Null when it could not be read. */
  jt: { bills: number; uncoded: number; laborHours: number; laborCost: number; unapprovedHours: number } | null;
  /** When the month was filed on this sheet (the `finalize` stamp), or "". */
  closedAt: string;
}

export interface MonthClosePreview {
  ym: string;
  sheetsYm: string;
  paused: boolean;
  rows: MonthCloseRow[];
  progress: { closed: number; total: number; done: boolean };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run `fn` over `items`, `limit` at a time. Apps Script answers slowly; a burst of 12 is unkind. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("ym") ?? "";
  const onlyProject = req.nextUrl.searchParams.get("projectId") ?? "";
  if (asked && !isYm(asked)) return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });

  const list = await callAppsScript<Record<string, unknown>>({ action: "listTrackingSheetJobs" });
  if (list.error) return NextResponse.json({ error: list.error }, { status: list.status });
  const b = list.data!;
  if (b.ok !== true) return NextResponse.json({ error: String(b.error || "Apps Script rejected the request.") }, { status: 502 });

  const sheetsYm = `${b.defaultYear}-${String(b.defaultMonth).padStart(2, "0")}`;
  const ym = asked || sheetsYm;
  const [year, month] = ym.split("-").map(Number);
  const paused = (b.sync as { paused?: boolean } | undefined)?.paused === true;

  const shared = new Set<string>();
  for (const s of (b.shared as { projects?: { projectId: string }[] }[]) ?? []) {
    for (const p of s.projects ?? []) shared.add(String(p.projectId));
  }
  const all = ((b.jobs as Job[]) ?? []).filter((j) => j.id && j.url);
  const jobs = onlyProject ? all.filter((j) => j.id === onlyProject) : all;
  if (onlyProject && !jobs.length) {
    return NextResponse.json({ error: "No tracking sheet is wired to that project." }, { status: 404 });
  }

  const stamps = new Map<string, string>();
  try {
    for (const r of await listMonthActions(ym)) if (r.action === "finalize") stamps.set(r.scope, r.at);
  } catch {
    /* No stamps is not a reason to refuse the preview. */
  }

  const cfg = getPaveConfig();
  const rows = await pool(jobs, 4, async (job): Promise<MonthCloseRow> => {
    const [read, dry, jt] = await Promise.all([
      callAppsScript<Record<string, unknown>>({ action: "readTrackingSheet", jtJobId: job.jtJobId }, { retry: true, timeoutMs: 60_000 })
        .then((r) => {
          if (r.error || r.data?.ok !== true) throw new Error(r.error || String(r.data?.error ?? "no answer"));
          return { subVendor: (r.data.subVendor as Grid) ?? [], labor: (r.data.labor as Grid) ?? [] };
        })
        .catch((e) => ({ error: errMsg(e) })),
      // A dry run: finalize reports the block it would write and writes nothing.
      callAppsScript<Record<string, unknown>>(
        { action: "finalizeTrackingSheet", projectId: job.id, month, year, dryRun: true },
        { retry: true, timeoutMs: 60_000 },
      )
        .then((r) => {
          if (r.error || r.data?.ok !== true) throw new Error(r.error || String(r.data?.error ?? "no answer"));
          return r.data as FinalizeDryRun;
        })
        .catch((e) => ({ error: errMsg(e) })),
      (async () => {
        const [bills, entries] = await Promise.all([
          getJobBillsForMonth(cfg, job.jtJobId, year, month, true, true),
          getJobTimeEntriesForMonth(cfg, job.jtJobId, year, month),
        ]);
        const lines = await getBillLinesForJob(cfg, job.jtJobId, bills.map((x) => x.id));
        const t = totalJtLines(bills, lines);
        const labor = Object.values(totalJtLabor(entries));
        const sum = (k: "hours" | "cost" | "unapprovedHours") => Math.round(labor.reduce((s, v) => s + v[k], 0) * 100) / 100;
        return {
          bills: t.total,
          uncoded: t.uncoded.length,
          laborHours: sum("hours"),
          laborCost: sum("cost"),
          unapprovedHours: sum("unapprovedHours"),
        };
      })().catch(() => null),
    ]);

    const readOk = !("error" in read);
    const labor = checkLaborMonth(readOk ? read.labor : null, ym);
    const dryOk = !("error" in dry);
    const plan = planSheet({
      shared: shared.has(job.id),
      readError: readOk ? undefined : `The sheet could not be read: ${read.error}`,
      finalizeError: dryOk ? undefined : dry.error,
      dry: dryOk ? dry : undefined,
      labor,
    });
    let sheet: MonthCloseRow["sheet"] = null;
    if (readOk) {
      const l = readLabor(read.labor);
      sheet = { bills: readSubVendor(read.subVendor).rowsTotal, laborHours: l.hoursTotal, laborCost: l.costTotal };
    }
    return {
      projectId: job.id,
      jtJobId: job.jtJobId,
      label: job.label,
      url: job.url,
      plan,
      labor,
      block: dryOk
        ? {
            label: String(dry.monthLabel ?? ""),
            range: String(dry.targetRange ?? ""),
            labelCell: String(dry.labelCell ?? ""),
            blocksRemaining: typeof dry.blocksRemaining === "number" ? dry.blocksRemaining : null,
          }
        : null,
      sheet,
      jt,
      closedAt: stamps.get(job.id) ?? "",
    };
  });

  rows.sort((a, b) => a.label.localeCompare(b.label));
  const closed = new Set(rows.filter((r) => r.closedAt || r.plan.action === "filed").map((r) => r.projectId));
  const body: MonthClosePreview = {
    ym,
    sheetsYm,
    paused,
    rows,
    progress: closeProgress(rows.map((r) => r.projectId), closed),
  };
  return NextResponse.json(body);
}
