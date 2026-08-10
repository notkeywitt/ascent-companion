import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

// Proxy the "Not in JobTread" queue to the Apps Script doPost router.
//
// These are ingested Expenditure rows that never reached JobTread — no JT Doc
// ID, not dismissed, JT-era billing period. They are invisible to every other
// surface in the system: the hourly sync only mirrors JobTread → sheet (no JT
// bill, nothing to reconcile), /coding lists JobTread draft bills, and
// /needs-project deliberately skips any row that already has a Project ID. So a
// bill whose amounts were mis-extracted but whose job resolved fine simply sat
// unbilled. This queue is the only place it surfaces.
//
// The push applies the office's corrections (job, received date, line coding +
// amounts) and then runs the normal first-push path, all inside the Apps Script
// sync lock — so it takes a while. Allow a longer timeout than the default, the
// same way /api/needs-project does for its inline push.
//
// Env (shared with /api/needs-project, /api/email, /api/jt-sync):
//   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET
export const maxDuration = 120;

const PUSH_TIMEOUT_MS = 110_000;

// GET /api/uncaptured
//   → { ok, items: [{ expId, vendor, amount, date, status, projectId, jtJobId,
//                     billingMonth, billingYear, driveUrl, paymentReceipt,
//                     lines: [{ lineId, csi, description, amount }] }] }
export async function GET() {
  return callAppsScriptResponse({ action: "listUncaptured" });
}

// POST /api/uncaptured
//   { expId, lines?, jobId?, dateReceived? } → pushUncaptured    → { ok, docId, amount }
//   { expId, dismiss: true }                 → dismissUncaptured → { ok, expId }
//   { expId, delete: true }                  → deleteUncaptured  → { ok, expId, trashed }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const expId = String(body.expId ?? "").trim();
  if (!expId) {
    return NextResponse.json({ error: "expId is required." }, { status: 400 });
  }

  if (body.dismiss === true) {
    return callAppsScriptResponse({ action: "dismissUncaptured", expId });
  }

  // Destructive: the Apps Script handler refuses without confirm:true. We send it
  // explicitly rather than defaulting it on, so an accidental POST can't delete.
  if (body.delete === true) {
    return callAppsScriptResponse({ action: "deleteUncaptured", expId, confirm: true });
  }

  // Push. `lines` is optional — omitted means "push what's already on the row".
  // When present it REPLACES every child line, so validate it here rather than
  // letting a stray blank row become a $0 line in JobTread.
  const payload: Record<string, unknown> = { action: "pushUncaptured", expId };

  if (Array.isArray(body.lines)) {
    const lines = body.lines as Array<Record<string, unknown>>;
    if (lines.length === 0) {
      return NextResponse.json(
        { error: "A bill needs at least one line — dismiss or delete it instead." },
        { status: 400 },
      );
    }
    const clean = lines.map((ln) => ({
      csi: String(ln.csi ?? "").trim(),
      description: String(ln.description ?? "").trim(),
      amount: Number(ln.amount ?? 0),
    }));
    const bad = clean.findIndex((ln) => !ln.csi || !Number.isFinite(ln.amount));
    if (bad !== -1) {
      return NextResponse.json(
        { error: `Line ${bad + 1} needs a cost code and a numeric amount.` },
        { status: 400 },
      );
    }
    payload.lines = clean;
  }

  const jobId = String(body.jobId ?? "").trim();
  if (jobId) payload.jobId = jobId;

  const dateReceived = String(body.dateReceived ?? "").trim();
  if (dateReceived) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateReceived)) {
      return NextResponse.json({ error: "dateReceived must be yyyy-MM-dd." }, { status: 400 });
    }
    payload.dateReceived = dateReceived;
  }

  return callAppsScriptResponse(payload, { timeoutMs: PUSH_TIMEOUT_MS });
}
