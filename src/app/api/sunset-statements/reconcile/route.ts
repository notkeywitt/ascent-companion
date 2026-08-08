import { NextResponse } from "next/server";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

// GET /api/sunset-statements/reconcile
// Returns, per statement ExpID, the sum + list of the individual Sunset INVOICES
// ingested for that statement's project + billing month/year — so the /payments
// ("Sunset Statements") page can show, next to each statement total, whether every
// invoice on it is accounted for. Read-only (Apps Script sums sheet rows; nothing
// is written). Kept separate from the statements list so the list stays fast and
// paid-state logic is untouched.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 45; // sheet sum + one live JobTread bill-status query

interface Invoice {
  number: string;
  amount: number;
  isCredit: boolean;
  date: string;
  docId: string;
  jobId: string;
}
interface MatchInvoice {
  number: string;
  statementAmount?: number;
  systemAmount?: number;
  isCredit?: boolean;
  date: string;
  docId: string;
  jobId: string;
  elsewhere?: boolean;
  fuzzy?: boolean;
}
interface MatchBlock {
  matched: MatchInvoice[];
  mismatched: MatchInvoice[];
  missing: MatchInvoice[];
  extra: MatchInvoice[];
  extraCredits: MatchInvoice[];
}
interface Reconciliation {
  projectId: string;
  month: string;
  year: string;
  invoiceCount: number;
  chargeTotal: number;
  creditCount: number;
  creditTotal: number;
  netTotal: number;
  invoices: Invoice[];
  // Invoice-number reconciliation (null/absent for statements ingested before line-item capture).
  hasLineItems?: boolean;
  statementLineCount?: number;
  statementTotal?: number;
  match?: MatchBlock | null;
}

export async function GET() {
  try {
    const resp = await callAppsScriptOrThrow(
      { action: "reconcileSunsetStatements" },
      // Sheet sum + a live JT bill-status query; stay under maxDuration (45s).
      { timeoutMs: 38_000 },
    );
    const reconciliation = (resp.reconciliation as Record<string, Reconciliation>) ?? {};
    return NextResponse.json({ ok: true, reconciliation, liveChecked: resp.liveChecked !== false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
