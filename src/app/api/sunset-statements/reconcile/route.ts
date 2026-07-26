import { NextResponse } from "next/server";

// GET /api/sunset-statements/reconcile
// Returns, per statement ExpID, the sum + list of the individual Sunset INVOICES
// ingested for that statement's project + billing month/year — so the /payments
// ("Sunset Statements") page can show, next to each statement total, whether every
// invoice on it is accounted for. Read-only (Apps Script sums sheet rows; nothing
// is written). Kept separate from the statements list so the list stays fast and
// paid-state logic is untouched.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 30; // one Apps Script sheet-sum call, no Gemini

interface Invoice {
  number: string;
  amount: number;
  date: string;
  docId: string;
  jobId: string;
}
interface Reconciliation {
  projectId: string;
  month: string;
  year: string;
  invoiceCount: number;
  invoiceTotal: number;
  invoices: Invoice[];
}

async function callAppsScript(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    throw new Error("APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow",
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.ok === false) throw new Error(String(json.error ?? "Apps Script reported an error."));
  return json;
}

export async function GET() {
  try {
    const resp = await callAppsScript({ action: "reconcileSunsetStatements" });
    const reconciliation = (resp.reconciliation as Record<string, Reconciliation>) ?? {};
    return NextResponse.json({ ok: true, reconciliation });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
