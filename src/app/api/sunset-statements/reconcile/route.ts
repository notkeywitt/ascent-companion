import { NextResponse } from "next/server";
import { db, ensureDb } from "@/db";
import { sunsetStatementLinks } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

// GET /api/sunset-statements/reconcile
// Returns, per statement ExpID, the Sunset invoices that statement accounts for —
// so the /payments ("Sunset Statements") page can show whether every invoice on it
// is in JobTread. Appscript matches each billing MONTH as a whole: a statement line
// finds its bill on any job (the office moves mis-attributed bills; the statement
// never follows), and each bill counts toward one statement. The office's links
// (/api/sunset-statement-links) are read here and passed along; appscript applies
// them before any automatic match. Read-only: nothing is written.
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
  linked?: boolean;
  jobName?: string;
  systemNumber?: string;
  claimedBy?: string;
  line?: string;
  // Office flagged this bill "Bought Back" in the Reconcile Overrides tab — a
  // statement/system amount difference on it is expected, not a mismatch.
  boughtBack?: boolean;
  boughtBackAmount?: number;
}
interface MatchBlock {
  matched: MatchInvoice[];
  mismatched: MatchInvoice[];
  missing: MatchInvoice[];
  extra: MatchInvoice[];
  extraCredits: MatchInvoice[];
  movedOut?: MatchInvoice[];
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
  // Σ (statement − system) over bought-back-tagged matches — netTotal is expectedly
  // short by this much.
  boughtBackTotal?: number;
}

export async function GET() {
  try {
    await ensureDb();
    const links = (await db.select().from(sunsetStatementLinks)).map((l) => ({
      statementId: l.statementExpId,
      line: l.lineNumber,
      docId: l.docId,
      number: l.invoiceNumber,
    }));
    const resp = await callAppsScriptOrThrow(
      { action: "reconcileSunsetStatements", links },
      // Sheet sum + a live JT bill-status query; stay under maxDuration (45s).
      { timeoutMs: 38_000 },
    );
    const reconciliation = (resp.reconciliation as Record<string, Reconciliation>) ?? {};
    return NextResponse.json({
      ok: true,
      reconciliation,
      liveChecked: resp.liveChecked !== false,
      // Absent until the month-wide appscript reconcile is deployed — the page
      // then hides Link and the month panel.
      months: resp.months ?? null,
      staleLinks: resp.staleLinks ?? [],
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
