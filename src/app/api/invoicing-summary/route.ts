import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * The monthly Invoicing Package — proxy to Apps Script
 * (`MonthlyInvoicingSummary.js`).
 *
 * Apps Script holds the Sheets, Drive and Docs grants; the Assistant is the UI.
 * It also holds the numbers: the same `_tsPullBillCostItems` the tracking-sheet
 * push uses, so the page and the doc can never disagree with the sheet.
 *
 * Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
 *
 *   GET  ?ym=YYYY-MM                    → the month: jobs, figures, edits, doc
 *   POST { op:"save",  ym, jobId?, … }  → one edit to the overrides tab
 *   POST { op:"build", ym, dryRun? }    → write the Google Doc now
 *
 * Omit `ym` on the GET and Apps Script answers for the PINNED tracking period —
 * the month the wired sheets actually hold, which is the month the office is
 * closing.
 *
 * The read pages a whole month of JobTread cost items, time entries and
 * invoices, then walks Drive for each job's billing folder, so it runs tens of
 * seconds — hence the extended function timeout, matching /api/tracking-sheet.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Apps Script budget. Just under this route's maxDuration. */
const SCRIPT_TIMEOUT_MS = 110_000;

/** "2026-08" → { month: 8, year: 2026 }. Null for anything else. */
function parseYm(ym: unknown): { month: number; year: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { month, year };
}

/** Apps Script reports its own failures in the body, not the status code. */
function unwrap(b: Record<string, unknown>, fallback: string) {
  if (b.ok !== true) {
    return NextResponse.json({ error: String(b.error || fallback) }, { status: 502 });
  }
  return NextResponse.json(b);
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ym");
  // No ym is not an error: it means "the month the sheets are on".
  const period = raw ? parseYm(raw) : null;
  if (raw && !period) {
    return NextResponse.json({ error: "ym must look like 2026-08." }, { status: 400 });
  }

  const res = await callAppsScript<Record<string, unknown>>(
    { action: "invoicingSummary", ...(period ?? {}) },
    { timeoutMs: SCRIPT_TIMEOUT_MS },
  );
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  return unwrap(res.data!, "The Invoicing Package could not be read.");
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const op = String(body.op || "");
  if (op !== "save" && op !== "build") {
    return NextResponse.json(
      { error: `Unknown op "${op}" — expected "save" or "build".` },
      { status: 400 },
    );
  }

  const period = parseYm(body.ym);
  if (!period) {
    return NextResponse.json({ error: "A billing month (ym=2026-08) is required." }, { status: 400 });
  }

  if (op === "build") {
    const res = await callAppsScript<Record<string, unknown>>(
      { action: "buildInvoicingSummary", ...period, dryRun: body.dryRun === true },
      { timeoutMs: SCRIPT_TIMEOUT_MS },
    );
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    return unwrap(res.data!, "The doc could not be written.");
  }

  // save — only the fields actually present are forwarded, so saving a note
  // cannot clear an include flag the office set a minute ago.
  const patch: Record<string, unknown> = {};
  for (const key of ["note", "customerLabel", "jobLabel", "headline", "closing"] as const) {
    if (body[key] !== undefined) patch[key] = String(body[key] ?? "");
  }
  if (body.include !== undefined) patch.include = body.include === true;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const res = await callAppsScript<Record<string, unknown>>(
    {
      action: "saveInvoicingSummary",
      ...period,
      jobId: String(body.jobId ?? ""),
      ...patch,
    },
    { timeoutMs: 30_000 },
  );
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  return unwrap(res.data!, "The edit could not be saved.");
}
