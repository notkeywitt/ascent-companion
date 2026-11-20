import { revalidateTag, unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import type { RiskCode } from "@/components/TrackingSheetRisks";
import { callAppsScript } from "@/lib/appsScript";
import { writeDepositSheet, type DepositSheetResult } from "@/lib/depositRead";
import { report, type FindingInput } from "@/lib/findings";
import { money } from "@/lib/money";
import { getMonthAction, recordMonthAction } from "@/lib/monthActions";
import { sheetWriteBlocked } from "@/lib/monthClose";
import { advanceSheets, planOneSheet, SHEET_JOBS_TAG, type SheetJob } from "@/lib/monthCloseServer";

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
//   POST { op:"setPeriod", month, year }          — org-wide, no project
//   POST { op:"setPaused", paused, note? }        — org-wide, no project/month
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
  // Pause/resume that automatic sync. Global, and the one op that carries
  // neither a project nor a month.
  setPaused: "setTrackingSyncPaused",
};

/** Ops that act on every wired sheet at once, so they carry no projectId. */
const ORG_WIDE_OPS = new Set(["setPeriod", "setPaused"]);
/** Ops that name a billing period. setPaused is the one that does not. */
const PERIOD_OPS = new Set(["sync", "finalize", "setPeriod"]);

/** What a failed read throws, so unstable_cache stores nothing for it. */
class SheetJobsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * The wired sheets, cached 5 minutes in Next's shared Data Cache. Apps Script
 * takes 2 to 10 seconds to answer, and every job open asked it. The list only
 * changes when someone wires a sheet or an org-wide op runs, and the POST below
 * clears it then. A failure throws, so it is never cached.
 */
const getSheetJobs = unstable_cache(
  async () => {
    const res = await callAppsScript<Record<string, unknown>>({ action: "listTrackingSheetJobs" });
    if (res.error) throw new SheetJobsError(res.error, res.status);
    const b = res.data!;
    if (b.ok !== true) throw new SheetJobsError(String(b.error || "Apps Script rejected the request."), 502);
    return b;
  },
  ["tracking-sheet-jobs"],
  { revalidate: 300, tags: [SHEET_JOBS_TAG] },
);

/** One inbox row per code a sync says will not reach the sheet. */
function sheetRisks(b: Record<string, unknown>): FindingInput[] {
  const sheet = String(b.trackingSheetName || "Tracking sheet");
  const rows = (list: unknown, kind: string, what: string) =>
    ((Array.isArray(list) ? list : []) as RiskCode[]).map((c) => ({
      key: `${kind}|${c.csi}|${c.column ?? ""}`,
      kind,
      subject: sheet,
      title: `${sheet}: ${c.csi}${c.column ? ` @${c.column}` : ""} ${what} (${money(Number(c.amount) || 0)})`,
      link: "/trackingsheet",
    }));
  return [
    ...rows(b.unmatched, "sheet-missing-code", "has no column on the sheet"),
    ...rows(b.deadColumns, "sheet-dead-column", "column lost its formula and reads $0"),
  ];
}

export async function GET() {
  try {
    return NextResponse.json(await getSheetJobs());
  } catch (e) {
    if (e instanceof SheetJobsError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
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

  // The org-wide ops (setPeriod / setPaused) act on EVERY wired sheet, so they
  // carry no project.
  const projectId = String(body.projectId || "").trim();
  if (!projectId && !ORG_WIDE_OPS.has(op)) {
    return NextResponse.json({ error: "A project is required." }, { status: 400 });
  }

  // setPaused is the one op with no billing period at all — validating a month
  // it never sends would reject every pause.
  const month = Number(body.month);
  const year = Number(body.year);
  if (PERIOD_OPS.has(op)) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "A billing month (1-12) is required." }, { status: 400 });
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "A billing year is required." }, { status: 400 });
    }
  }

  // THE MONTH CLOSE RULES (src/lib/monthClose.ts), here so every button that
  // writes a sheet obeys them. A sync or finalize writes only the sheets'
  // month, or an earlier month on a sheet the close skipped. A finalize runs
  // only when the close would copy: never over a block that already holds the
  // month, never with another month's labor, never on a sheet wired twice.
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  /** A real sync also rewrites the sheet's Deposits tab (deposits stage 3). It
   *  runs beside the sync, to stay inside maxDuration, and never fails it. */
  let depositSheet: Promise<DepositSheetResult> | null = null;
  if ((op === "sync" || op === "finalize") && body.dryRun !== true) {
    let list: Record<string, unknown>;
    try {
      list = (await getSheetJobs()) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof SheetJobsError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
    const sheetsYm = `${list.defaultYear}-${String(list.defaultMonth).padStart(2, "0")}`;
    const filed = (await getMonthAction("finalize", projectId, ym).catch(() => undefined)) !== undefined;
    const why = sheetWriteBlocked(ym, sheetsYm, filed);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    if (op === "sync") {
      const job = ((list.jobs as SheetJob[]) ?? []).find((j) => j.id === projectId);
      if (job?.jtJobId) depositSheet = writeDepositSheet({ jtJobId: job.jtJobId, projectId, ym });
    }
    if (op === "finalize") {
      const job = ((list.jobs as SheetJob[]) ?? []).find((j) => j.id === projectId);
      if (!job) return NextResponse.json({ error: "No tracking sheet is wired to that project." }, { status: 404 });
      const shared = ((list.shared as { projects?: { projectId: string }[] }[]) ?? []).some((s) =>
        (s.projects ?? []).some((p) => String(p.projectId) === projectId),
      );
      const one = await planOneSheet(job, ym, shared);
      if (one.plan.action !== "copy") {
        return NextResponse.json(
          { error: one.plan.reasons.join(" ") || "The close would not file this sheet.", plan: one.plan },
          { status: 409 },
        );
      }
    }
  }

  const res = await callAppsScript<Record<string, unknown>>(
    {
      action,
      projectId,
      ...(PERIOD_OPS.has(op) ? { month, year } : {}),
      ...(op === "setPaused"
        ? { paused: body.paused === true, note: String(body.note || "") }
        : {}),
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
  // A sync's risks (components/TrackingSheetRisks) go into the findings inbox,
  // one scope per sheet. Only when the answer carries the lists: no list, no report.
  if (op === "sync" && Array.isArray(b.unmatched)) {
    await report("tracking-sheet-risks", sheetRisks(b), projectId).catch(() => {});
  }
  // Sync and finalize can change what the list reports; setPeriod and setPaused
  // do. A dry run changes nothing.
  if (body.dryRun !== true) revalidateTag(SHEET_JOBS_TAG);
  // Stamped per project and month: the all-jobs card reads the sync, and the
  // pin-advance guard reads the finalize (a month must be finalized into its
  // block on every wired sheet before the timer may move on).
  if ((op === "sync" || op === "finalize") && body.dryRun !== true) {
    const session = await auth();
    await recordMonthAction(
      op === "sync" ? "tracking-sync" : "finalize",
      projectId,
      `${year}-${String(month).padStart(2, "0")}`,
      session?.user?.email ?? "",
      op === "finalize" ? String(b.monthLabel ?? "") : "",
    );
  }
  // The last sheet filed moves the sheets to the next month.
  if (op === "finalize" && body.dryRun !== true) {
    try {
      const advanced = await advanceSheets(ym);
      if (advanced) revalidateTag(SHEET_JOBS_TAG);
      return NextResponse.json({ ...b, advanced });
    } catch (e) {
      return NextResponse.json({ ...b, advanced: "", advanceError: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json(depositSheet ? { ...b, depositSheet: await depositSheet } : b);
}
