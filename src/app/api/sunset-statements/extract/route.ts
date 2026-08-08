import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatements } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

// POST /api/sunset-statements/extract  { expIds: string[] }
// Gemini-extract the pay-at-TSYS header for a SMALL batch of statements and cache
// it. The /payments page calls this in bounded batches to progressively fill the
// list, so no single request ever runs unbounded Gemini work (which timed the old
// all-in-one GET out). Extraction never touches paid-state; re-extracting is safe.
//
// Returns { ok, extracted: { <expId>: row }, failed: string[] } — `failed` lists
// asked ids the extractor couldn't read (e.g. missing/garbled PDF) so the page can
// stop waiting on them.
export const maxDuration = 60; // capped batch of Gemini reads

const MAX_BATCH = 8;

const fmt = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "";
};

interface Extracted {
  accountName: string;
  statementNumber: string;
  total: number;
  discount: number;
  net: number;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const expIds = Array.isArray(body.expIds)
    ? body.expIds.map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_BATCH)
    : [];
  if (!expIds.length) return NextResponse.json({ ok: true, extracted: {}, failed: [] });

  try {
    await ensureDb();
    const resp = await callAppsScriptOrThrow(
      { action: "extractSunsetStatements", expIds },
      // A bounded batch of Gemini reads; stay under maxDuration (60s). A write.
      { timeoutMs: 50_000 },
    );
    const extracted = (resp.extracted as Record<string, Extracted>) ?? {};

    const now = new Date().toISOString();
    const out: Record<string, (typeof sunsetStatements.$inferSelect)> = {};
    for (const expId of expIds) {
      const ex = extracted[expId];
      if (!ex) continue; // couldn't read this one
      const [row] = await db
        .update(sunsetStatements)
        .set({
          accountName: ex.accountName,
          statementNumber: ex.statementNumber,
          total: fmt(ex.total),
          discount: fmt(ex.discount),
          net: fmt(ex.net),
          extractedAt: now,
          updatedAt: now,
        })
        .where(eq(sunsetStatements.expId, expId))
        .returning();
      if (row) out[expId] = row;
    }
    const failed = expIds.filter((id) => !out[id]);
    return NextResponse.json({ ok: true, extracted: out, failed });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
