import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig } from "@/lib/config";
import { getBillLinesForJob, getJobBillsForMonth, getJobTimeEntriesForMonth } from "@/lib/jobtread";
import { closeProgress, isYm, type LaborMonthCheck, type SheetPlan } from "@/lib/monthClose";
import {
  advanceSheets,
  filedStamps,
  markFiled,
  planOneSheet,
  readSheetList,
  SHEET_JOBS_TAG,
  type SheetJob,
} from "@/lib/monthCloseServer";
import { readLabor, readSubVendor, totalJtLabor, totalJtLines } from "@/lib/invoiceReview/sheetCompare";

/**
 * The tracking-sheet month close. Rules: src/lib/monthClose.ts.
 *
 * GET ?ym=YYYY-MM[&projectId=…] — the PREVIEW. Writes nothing. For each wired
 *   sheet (or the one `projectId`): what the close would do (copy into a
 *   block, leave a filed block, or skip a broken sheet), the target block from
 *   a finalize dry run, the Labor tab's month check, and the sheet's bills and
 *   labor beside JobTread's. `ym` defaults to the sheets' month.
 *
 * POST { op:"markFiled", projectId, ym } — a sheet whose block already holds
 *   the month counts as closed. Re-checked here first.
 * POST { op:"advance", ym, force? } — move the sheets to the next month once
 *   every sheet has `ym` filed; `force` is "close the rest", which moves them
 *   with the skipped sheets named. Stores the month only; writes no sheet.
 *
 * The sheet writes themselves (sync, finalize) stay on /api/tracking-sheet,
 * which applies the same rules. Gated with the Tracking Sheets view
 * (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

async function jtFigures(job: SheetJob, year: number, month: number): Promise<MonthCloseRow["jt"]> {
  const cfg = getPaveConfig();
  const [bills, entries] = await Promise.all([
    getJobBillsForMonth(cfg, job.jtJobId, year, month, true, true),
    getJobTimeEntriesForMonth(cfg, job.jtJobId, year, month),
  ]);
  const lines = await getBillLinesForJob(cfg, job.jtJobId, bills.map((x) => x.id));
  const t = totalJtLines(bills, lines);
  const labor = Object.values(totalJtLabor(entries));
  const sum = (k: "hours" | "cost" | "unapprovedHours") =>
    Math.round(labor.reduce((s, v) => s + v[k], 0) * 100) / 100;
  return {
    bills: t.total,
    uncoded: t.uncoded.length,
    laborHours: sum("hours"),
    laborCost: sum("cost"),
    unapprovedHours: sum("unapprovedHours"),
  };
}

export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("ym") ?? "";
  const onlyProject = req.nextUrl.searchParams.get("projectId") ?? "";
  if (asked && !isYm(asked)) return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });

  let list;
  try {
    list = await readSheetList();
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
  const ym = asked || list.sheetsYm;
  const [year, month] = ym.split("-").map(Number);
  const jobs = onlyProject ? list.jobs.filter((j) => j.id === onlyProject) : list.jobs;
  if (onlyProject && !jobs.length) {
    return NextResponse.json({ error: "No tracking sheet is wired to that project." }, { status: 404 });
  }
  const stamps = await filedStamps(ym).catch(() => new Map<string, string>());

  const rows = await pool(jobs, 4, async (job): Promise<MonthCloseRow> => {
    const [one, jt] = await Promise.all([
      planOneSheet(job, ym, list.shared.has(job.id)),
      jtFigures(job, year, month).catch(() => null),
    ]);
    let sheet: MonthCloseRow["sheet"] = null;
    if (one.read) {
      const l = readLabor(one.read.labor);
      sheet = { bills: readSubVendor(one.read.subVendor).rowsTotal, laborHours: l.hoursTotal, laborCost: l.costTotal };
    }
    const d = one.dry;
    return {
      projectId: job.id,
      jtJobId: job.jtJobId,
      label: job.label,
      url: job.url,
      plan: one.plan,
      labor: one.labor,
      block: d
        ? {
            label: String(d.monthLabel ?? ""),
            range: String(d.targetRange ?? ""),
            labelCell: String(d.labelCell ?? ""),
            blocksRemaining: typeof d.blocksRemaining === "number" ? d.blocksRemaining : null,
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
    sheetsYm: list.sheetsYm,
    paused: list.paused,
    rows,
    progress: closeProgress(rows.map((r) => r.projectId), closed),
  };
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const op = String(body.op || "");
  const ym = String(body.ym || "");
  if (!isYm(ym)) return NextResponse.json({ error: 'Pass ym as "YYYY-MM".' }, { status: 400 });
  const session = await auth();
  const by = session?.user?.email ?? "";

  try {
    if (op === "markFiled") {
      const projectId = String(body.projectId || "");
      const list = await readSheetList();
      const job = list.jobs.find((j) => j.id === projectId);
      if (!job) return NextResponse.json({ error: "No tracking sheet is wired to that project." }, { status: 404 });
      const one = await planOneSheet(job, ym, list.shared.has(job.id));
      if (one.plan.action !== "filed") {
        return NextResponse.json({ error: "That sheet's block does not hold the month yet." }, { status: 409 });
      }
      await markFiled(projectId, ym, by, String(one.dry?.monthLabel ?? ""));
      const advanced = await advanceSheets(ym);
      if (advanced) revalidateTag(SHEET_JOBS_TAG);
      return NextResponse.json({ ok: true, advanced });
    }
    if (op === "advance") {
      const advanced = await advanceSheets(ym, { force: body.force === true });
      if (advanced) revalidateTag(SHEET_JOBS_TAG);
      return NextResponse.json({ ok: true, advanced });
    }
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
  return NextResponse.json({ error: `Unknown op "${op}". Expected markFiled or advance.` }, { status: 400 });
}
