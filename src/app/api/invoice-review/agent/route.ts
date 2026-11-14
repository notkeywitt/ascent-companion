import { NextRequest, NextResponse } from "next/server";

import { authorizeAgent as authorize } from "@/lib/agentToken";
import { callAppsScript } from "@/lib/appsScript";
import { currentBillingPeriod } from "@/lib/billingMonth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getBillLinesForJob, getJobBillsForMonth, getJobTimeEntriesForMonth } from "@/lib/jobtread";
import { DIGEST_GLOBAL } from "@/lib/digest/settings";
import {
  VERDICTS,
  attachDispositions,
  readDispositions,
  saveDispositions,
  type DispositionInput,
} from "@/lib/invoiceReview/dispositions";
import { findingPrint } from "@/lib/invoiceReview/types";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { activeInstructions } from "@/lib/invoiceReview/instructions";
import {
  beginInvestigation,
  failInvestigation,
  finishInvestigation,
  logMonthlyCheckRun,
  readInvestigation,
} from "@/lib/invoiceReview/investigations";
import { runInvoiceReview } from "@/lib/invoiceReview/run";
import { listRuns, readLatestRun } from "@/lib/invoiceReview/runs";
import { reviewWindow, scheduledReview } from "@/lib/invoiceReview/schedule";
import { DEFAULT_SETTINGS as REVIEW_SETTINGS } from "@/lib/invoiceReview/settings";
import {
  compareTrackingSheet,
  findInvoiceColumns,
  totalJtLabor,
  totalJtLines,
  type Grid,
} from "@/lib/invoiceReview/sheetCompare";

/**
 * /api/invoice-review/agent — the door Claude Code on the office Mac uses.
 *
 * The monthly check's Claude work (chasing each finding, writing the month's
 * reading) runs in Claude Code on the office Mac, on the owner's Claude login,
 * not the Anthropic API. The coded checks still run HERE, because only this
 * deployment holds the JobTread key, the Apps Script secret and the database
 * token. This route is how the Mac reaches them.
 *
 * GET  ?action=schedule            is a review due today, and for which month
 * GET  ?action=read&ym=YYYY-MM     the latest filed run, its history, the
 *                                  owner's standing instructions, the pass state
 * GET  ?action=tracking            the legacy jobs with a Google Tracking Sheet
 * POST { action: "sheet-columns", ym, headers }   where the LABOR / INVOICES
 *                                  columns are on a sheet's Tracking Sheet tab
 * POST { action: "sheet-check", ym, jtJobId, subVendor, labor?, headers?,
 *        codes?, columns? }        compare one sheet with JobTread (sheetCompare.ts)
 * POST { action: "run", ym? }      file a fresh run (JobTread + Drive + mail)
 * POST { action: "begin", ym, model }            mark the pass as running
 * POST { action: "finish", ym, model, note, report, dispositions }
 *                                  file verdicts, the short reading and the full report
 * POST { action: "fail", ym, error }             file a failed pass
 * POST { action: "log", ym?, status, message, log? }   one scheduled-run event
 *
 * AUTH. A bearer token, REVIEW_AGENT_TOKEN, and nothing else — no session
 * fallback. Public in src/middleware.ts for that reason. Unset = 503.
 *
 * WRITES. Only the companion's own tables: the run row, the verdict rows and
 * the pass status line — the same rows the page itself writes. Nothing here
 * can change an invoice, a bill, a Drive file or a status in JobTread.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WHO = "claude-code";
const MAX_TEXT = 2000;

function monthOf(raw: unknown): string | null {
  const parsed = parseYm(String(raw ?? "").trim());
  return parsed ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}` : null;
}

const text = (v: unknown) => String(v ?? "").trim().slice(0, MAX_TEXT);

export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  const action = req.nextUrl.searchParams.get("action") ?? "";

  if (action === "schedule") {
    const now = new Date();
    const cutoff = DIGEST_GLOBAL.billingCutoffDay;
    const period = await currentBillingPeriod();
    return NextResponse.json({
      due: scheduledReview(now, REVIEW_SETTINGS.schedule, cutoff),
      window: reviewWindow(now, REVIEW_SETTINGS.schedule, cutoff),
      currentYm: `${period.billingYear}-${String(period.billingMonthNum).padStart(2, "0")}`,
    });
  }

  if (action === "read") {
    const ym = monthOf(req.nextUrl.searchParams.get("ym"));
    if (!ym) return NextResponse.json({ error: "Pass ym=YYYY-MM." }, { status: 400 });
    const [run, history, instructions, investigation, verdicts] = await Promise.all([
      readLatestRun(ym),
      listRuns(ym, 20),
      activeInstructions().catch(() => []),
      readInvestigation(ym),
      readDispositions(ym),
    ]);
    // The filed run carries the verdicts as they stood when it ran. A pass
    // that finished since then must count, or the next pass redoes its work.
    if (run?.payload) {
      run.payload.findings = attachDispositions(
        run.payload.findings.map(({ disposition: _old, ...f }) => f),
        verdicts,
      );
    }
    return NextResponse.json({
      ym,
      storedAt: run?.ranAt ?? null,
      ranBy: run?.ranBy ?? null,
      payload: run?.payload ?? null,
      history,
      instructions: instructions.map((i) => i.text),
      investigation,
    });
  }

  if (action === "tracking") {
    const res = await callAppsScript<Record<string, unknown>>({ action: "listTrackingSheetJobs" });
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    const jobs = ((res.data?.jobs as Record<string, unknown>[]) ?? [])
      .map((j) => {
        const url = String(j.url ?? "");
        return {
          jtJobId: String(j.jtJobId ?? ""),
          label: String(j.label ?? ""),
          url,
          spreadsheetId: url.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? "",
        };
      })
      .filter((j) => j.jtJobId && j.spreadsheetId);
    return NextResponse.json({ jobs });
  }

  return NextResponse.json({ error: "action must be schedule, read or tracking." }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const action = String(body.action ?? "");

  if (action === "run") {
    if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
    let ym = body.ym ? monthOf(body.ym) : null;
    if (body.ym && !ym) return NextResponse.json({ error: "ym must be YYYY-MM." }, { status: 400 });
    if (!ym) {
      const p = await currentBillingPeriod();
      ym = `${p.billingYear}-${String(p.billingMonthNum).padStart(2, "0")}`;
    }
    const [y, m] = ym.split("-").map(Number);
    try {
      const payload = await runInvoiceReview(getPaveConfig(), y, m, { saveAs: WHO });
      const live = payload.findings.filter((f) => !f.suppressedBy);
      return NextResponse.json({
        ok: true,
        ym,
        errors: live.filter((f) => f.severity === "error").length,
        warnings: live.filter((f) => f.severity === "warning").length,
        suppressed: payload.findings.length - live.length,
        evidenceWarnings: payload.evidence.warnings,
        durationMs: payload.durationMs,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed." }, { status: 500 });
    }
  }

  if (action === "log") {
    const logYm = body.ym ? monthOf(body.ym) ?? "" : "";
    await logMonthlyCheckRun({
      ym: logYm,
      status: text(body.status),
      message: text(body.message),
      log: String(body.log ?? ""),
    });
    return NextResponse.json({ ok: true });
  }

  const ym = monthOf(body.ym);
  if (!ym) return NextResponse.json({ error: "Pass ym: YYYY-MM." }, { status: 400 });
  const model = text(body.model) || "claude-code";

  if (action === "begin") {
    const claim = await beginInvestigation(ym, model, WHO);
    if (!claim.ok) {
      return NextResponse.json(
        { error: `A pass on ${ym} is already running (since ${claim.startedAt}).`, running: true },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "sheet-columns") {
    const [y, m] = ym.split("-").map(Number);
    return NextResponse.json(findInvoiceColumns((body.headers as Grid) ?? [], y, m));
  }

  if (action === "sheet-check") {
    if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
    const jobId = text(body.jtJobId);
    if (!jobId) return NextResponse.json({ error: "Pass jtJobId." }, { status: 400 });
    const [y, m] = ym.split("-").map(Number);
    try {
      const cfg = getPaveConfig();
      const [bills, entries] = await Promise.all([
        getJobBillsForMonth(cfg, jobId, y, m, true, true),
        getJobTimeEntriesForMonth(cfg, jobId, y, m),
      ]);
      const lines = await getBillLinesForJob(cfg, jobId, bills.map((b) => b.id));
      const result = compareTrackingSheet({
        year: y,
        month: m,
        jt: totalJtLines(bills, lines),
        jtLabor: totalJtLabor(entries),
        subVendor: (body.subVendor as Grid) ?? [],
        labor: body.labor as Grid | undefined,
        headers: body.headers as Grid | undefined,
        codes: body.codes as Grid | undefined,
        columns: body.columns as Record<string, Grid> | undefined,
        firstRow: Number(body.firstRow) || 10,
      });
      return NextResponse.json({ ok: true, ym, jtJobId: jobId, ...result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Sheet check failed." }, { status: 500 });
    }
  }

  if (action === "fail") {
    await failInvestigation(ym, text(body.error) || "Claude Code stopped before it finished.");
    return NextResponse.json({ ok: true });
  }

  if (action === "finish") {
    const run = await readLatestRun(ym);
    if (!run?.payload) return NextResponse.json({ error: `No filed run for ${ym}.` }, { status: 404 });
    const known = new Map(run.payload.findings.map((f) => [f.key, findingPrint(f)]));

    const raw = Array.isArray(body.dispositions) ? body.dispositions : [];
    const items: DispositionInput[] = [];
    const rejected: string[] = [];
    for (const r of raw as Record<string, unknown>[]) {
      const key = text(r?.key);
      const verdict = text(r?.verdict);
      if (!known.has(key) || !VERDICTS.has(verdict)) {
        rejected.push(key || "(no key)");
        continue;
      }
      items.push({
        key,
        verdict: verdict as DispositionInput["verdict"],
        why: text(r.why),
        suggestedAction: text(r.suggestedAction),
        seen: known.get(key),
      });
    }

    const failed = await saveDispositions(ym, model, items);
    if (failed) {
      await failInvestigation(ym, `The verdicts could not be filed: ${failed}`);
      return NextResponse.json({ error: failed }, { status: 502 });
    }
    await finishInvestigation(ym, {
      model,
      note: String(body.note ?? "").trim().slice(0, 6000),
      findingsConsidered: run.payload.findings.filter((f) => !f.suppressedBy).length,
      dispositionCount: items.length,
      truncated: false,
      usage: null,
      report: String(body.report ?? "").slice(0, 100_000),
    });
    return NextResponse.json({ ok: true, saved: items.length, rejected });
  }

  return NextResponse.json(
    { error: "action must be run, begin, finish, fail, log, sheet-columns or sheet-check." },
    { status: 400 },
  );
}
