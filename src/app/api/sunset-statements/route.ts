import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatements } from "@/db/schema";

// The Sunset "/payments" list. Reads the statements from the sheet via Apps
// Script (listSunsetStatements — lightweight), then Gemini-extracts the payment
// header (account name, statement #, printed prompt discount, net) for any
// statement not already cached (extractSunsetStatements), persists the result to
// the companion DB, and returns the merged rows with paid-state. Extraction runs
// once per statement, so first load after new statements is the only slow one.
//
// Env (shared): APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET.
export const maxDuration = 120; // the first-time Gemini extraction loop can be slow

interface ListItem {
  expId: string;
  project: string;
  total: number;
  statementDate: string;
  pdfUrl: string;
}
interface Extracted {
  accountName: string;
  statementNumber: string;
  total: number;
  discount: number;
  net: number;
}

async function callAppsScript(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    throw new Error("APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.");
  }
  // Apps Script web apps answer via a 302 to a one-time content URL and always
  // report HTTP 200 there — success/failure is the "ok" field in the body.
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

const fmt = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "";
};

// GET /api/sunset-statements?status=unpaid|paid|all  (default unpaid)
export async function GET(req: NextRequest) {
  const status = (req.nextUrl.searchParams.get("status") ?? "unpaid").toLowerCase();
  try {
    await ensureDb();

    // 1. The authoritative list of statements (from the sheet).
    const listResp = await callAppsScript({ action: "listSunsetStatements" });
    const items = (listResp.items as ListItem[]) ?? [];

    // 2. What's already cached.
    const existing = await db.select().from(sunsetStatements);
    const byId = new Map(existing.map((r) => [r.expId, r]));

    // 3. Which statements still need a Gemini extraction (new, or never read).
    const toExtract = items
      .filter((it) => {
        const row = byId.get(it.expId);
        return !row || row.extractedAt === "";
      })
      .map((it) => it.expId);

    let extracted: Record<string, Extracted> = {};
    if (toExtract.length) {
      const exResp = await callAppsScript({ action: "extractSunsetStatements", expIds: toExtract });
      extracted = (exResp.extracted as Record<string, Extracted>) ?? {};
    }

    // 4. Reconcile: insert new rows, refresh cached fields. NEVER touch paid state.
    const now = new Date().toISOString();
    for (const it of items) {
      const row = byId.get(it.expId);
      const ex = extracted[it.expId];
      if (!row) {
        await db.insert(sunsetStatements).values({
          expId: it.expId,
          project: it.project,
          statementDate: it.statementDate,
          pdfUrl: it.pdfUrl,
          accountName: ex ? ex.accountName : "",
          statementNumber: ex ? ex.statementNumber : "",
          total: ex ? fmt(ex.total) : fmt(it.total),
          discount: ex ? fmt(ex.discount) : "",
          net: ex ? fmt(ex.net) : "",
          extractedAt: ex ? now : "",
          status: "unpaid",
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }
      // Existing: only write if extraction just arrived or a sheet field drifted.
      const drift =
        row.project !== it.project ||
        row.pdfUrl !== it.pdfUrl ||
        row.statementDate !== it.statementDate;
      if (!ex && !drift) continue;
      await db
        .update(sunsetStatements)
        .set({
          project: it.project,
          statementDate: it.statementDate,
          pdfUrl: it.pdfUrl,
          ...(ex
            ? {
                accountName: ex.accountName,
                statementNumber: ex.statementNumber,
                total: fmt(ex.total),
                discount: fmt(ex.discount),
                net: fmt(ex.net),
                extractedAt: now,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(sunsetStatements.expId, it.expId));
    }

    // 5. Return the current statements (sheet is source of truth for existence),
    //    merged with cached fields + paid state, filtered + newest-first.
    const finalRows = await db.select().from(sunsetStatements);
    const finalById = new Map(finalRows.map((r) => [r.expId, r]));
    const out = items
      .map((it) => finalById.get(it.expId))
      .filter((r): r is (typeof finalRows)[number] => Boolean(r))
      .filter((r) => (status === "all" ? true : r.status === status))
      .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || a.expId.localeCompare(b.expId));

    return NextResponse.json({ ok: true, items: out });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
