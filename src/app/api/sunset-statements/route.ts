import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatements } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

// The Sunset "/payments" list. Reads the statements from the sheet via Apps
// Script (listSunsetStatements — lightweight, no Gemini), reconciles them into
// the companion cache, and returns the merged rows with paid-state IMMEDIATELY.
//
// It deliberately does NOT extract here: the payment header (account name,
// statement #, printed discount, net) comes from a Gemini pass on each PDF, and
// doing that for every uncached statement in one request times the function out
// once there are more than a handful. The page fills the uncached rows in small
// bounded batches via POST /api/sunset-statements/extract instead.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 30; // one lightweight Apps Script call, no Gemini

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

    // 1. The authoritative list of statements (from the sheet). Fast, no Gemini.
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
      .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || a.expId.localeCompare(b.expId));

    return NextResponse.json({ ok: true, items: out, pending });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
