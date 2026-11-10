import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { currentBillingPeriod } from "@/lib/billingMonth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { DIGEST_GLOBAL } from "@/lib/digest/settings";
import { VERDICTS, saveDispositions, type DispositionInput } from "@/lib/invoiceReview/dispositions";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { activeInstructions } from "@/lib/invoiceReview/instructions";
import {
  beginInvestigation,
  failInvestigation,
  finishInvestigation,
  readInvestigation,
} from "@/lib/invoiceReview/investigations";
import { runInvoiceReview } from "@/lib/invoiceReview/run";
import { listRuns, readLatestRun } from "@/lib/invoiceReview/runs";
import { reviewWindow, scheduledReview } from "@/lib/invoiceReview/schedule";
import { DEFAULT_SETTINGS as REVIEW_SETTINGS } from "@/lib/invoiceReview/settings";

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
 * POST { action: "run", ym? }      file a fresh run (JobTread + Drive + mail)
 * POST { action: "begin", ym, model }            mark the pass as running
 * POST { action: "finish", ym, model, note, dispositions }  file verdicts + note
 * POST { action: "fail", ym, error }             file a failed pass
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

function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(req: NextRequest): NextResponse | null {
  const expected = (process.env.REVIEW_AGENT_TOKEN ?? "").trim();
  if (!expected) {
    return NextResponse.json({ error: "REVIEW_AGENT_TOKEN is not set on this deployment." }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return secretMatches(bearer, expected) ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

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
    const [run, history, instructions, investigation] = await Promise.all([
      readLatestRun(ym),
      listRuns(ym, 20),
      activeInstructions().catch(() => []),
      readInvestigation(ym),
    ]);
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

  return NextResponse.json({ error: "action must be schedule or read." }, { status: 400 });
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

  if (action === "fail") {
    await failInvestigation(ym, text(body.error) || "Claude Code stopped before it finished.");
    return NextResponse.json({ ok: true });
  }

  if (action === "finish") {
    const run = await readLatestRun(ym);
    if (!run?.payload) return NextResponse.json({ error: `No filed run for ${ym}.` }, { status: 404 });
    const known = new Set(run.payload.findings.map((f) => f.key));

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
    });
    return NextResponse.json({ ok: true, saved: items.length, rejected });
  }

  return NextResponse.json({ error: "action must be run, begin, finish or fail." }, { status: 400 });
}
