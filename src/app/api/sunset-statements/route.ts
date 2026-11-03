import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatements } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getSunsetStatementBillStates, type SunsetStatementBillState } from "@/lib/jobtread";
import { statementBillPaid } from "@/lib/sunsetStatementMonth";

// The Sunset "/payments" list. Reads the statements from the sheet via Apps
// Script (listSunsetStatements — lightweight, no model call), reconciles them into
// the companion cache, and returns the merged rows with paid-state IMMEDIATELY.
//
// It deliberately does NOT extract here: the payment header (account name,
// statement #, printed discount, net) comes from OCR + regex on each PDF (with
// Claude as the fallback), and doing that for every uncached statement in one
// request times the function out once there are more than a handful. The page fills the uncached rows in small
// bounded batches via POST /api/sunset-statements/extract instead.
//
// It also reads each statement's bill on the Office job (Create Bills). A
// statement whose bill is paid in full in JobTread is marked paid here, with
// paidBy "JobTread" — JobTread is the source of truth for payment. Each row
// carries its bill (`bill`), so the page can show it and Approve all knows the
// drafts. A failed JobTread read leaves the list as it was (`billsRead: false`).
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 45; // one lightweight Apps Script call + one JobTread read, no extraction

interface ListItem {
  expId: string;
  project: string;
  total: number;
  statementDate: string;
  pdfUrl: string;
}

const fmt = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "";
};

// GET /api/sunset-statements?status=unpaid|paid|all  (default unpaid)
export async function GET(req: NextRequest) {
  const status = (req.nextUrl.searchParams.get("status") ?? "unpaid").toLowerCase();
  try {
    await ensureDb();

    // 1. The authoritative list of statements (from the sheet). Fast, no extraction.
    const listResp = await callAppsScriptOrThrow({ action: "listSunsetStatements" });
    const items = (listResp.items as ListItem[]) ?? [];

    // 2. Reconcile into the cache: insert a stub for any new statement, refresh
    //    drifted sheet fields. NEVER extract here and NEVER touch paid-state.
    const existing = await db.select().from(sunsetStatements);
    const byId = new Map(existing.map((r) => [r.expId, r]));
    const now = new Date().toISOString();
    for (const it of items) {
      const row = byId.get(it.expId);
      if (!row) {
        await db.insert(sunsetStatements).values({
          expId: it.expId,
          project: it.project,
          statementDate: it.statementDate,
          pdfUrl: it.pdfUrl,
          total: fmt(it.total),
          status: "unpaid",
          createdAt: now,
          updatedAt: now,
        });
      } else if (
        row.project !== it.project ||
        row.pdfUrl !== it.pdfUrl ||
        row.statementDate !== it.statementDate
      ) {
        await db
          .update(sunsetStatements)
          .set({ project: it.project, pdfUrl: it.pdfUrl, statementDate: it.statementDate, updatedAt: now })
          .where(eq(sunsetStatements.expId, it.expId));
      }
    }

    // 2b. JobTread payment. Only ever sets paid — an "Undo paid" on a statement
    //     whose bill is still paid in JobTread is re-marked on the next read.
    let bills = new Map<string, SunsetStatementBillState>();
    let billsRead = false;
    if (hasGrant()) {
      try {
        bills = await getSunsetStatementBillStates(getPaveConfig());
        billsRead = true;
      } catch {
        /* the list still loads without the bills */
      }
    }
    for (const it of items) {
      const b = bills.get(it.expId);
      const row = byId.get(it.expId);
      if (!b || !statementBillPaid(b) || (row && row.status === "paid")) continue;
      await db
        .update(sunsetStatements)
        .set({ status: "paid", paidAt: b.paidAt || now, paidBy: "JobTread", updatedAt: now })
        .where(eq(sunsetStatements.expId, it.expId));
    }

    // 3. Return the current statements (sheet is source of truth for existence),
    //    filtered + newest-first. `pending` = how many still need extraction, so
    //    the page knows to fill them in.
    const finalRows = await db.select().from(sunsetStatements);
    const finalById = new Map(finalRows.map((r) => [r.expId, r]));
    const listed = items
      .map((it) => finalById.get(it.expId))
      .filter((r): r is (typeof finalRows)[number] => Boolean(r));
    const pending = listed.filter((r) => r.extractedAt === "").length;
    const out = listed
      .filter((r) => (status === "all" ? true : r.status === status))
      .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || a.expId.localeCompare(b.expId))
      .map((r) => ({ ...r, bill: bills.get(r.expId) ?? null }));
    // Every statement's bill, whatever the filter: Approve all acts on a whole
    // month, paid-in-app statements included.
    const monthBills = listed.flatMap((r) => {
      const b = bills.get(r.expId);
      return b ? [{ expId: r.expId, statementDate: r.statementDate, docId: b.docId, status: b.status, name: b.name }] : [];
    });

    return NextResponse.json({ ok: true, items: out, pending, billsRead, monthBills });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
