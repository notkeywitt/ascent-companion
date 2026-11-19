import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { checkMailed } from "@/db/schema";

/**
 * Accounts Payable "check mailed" marks. Companion database only — NOT a
 * JobTread write, so it ignores COMPANION_WRITES_ENABLED.
 *   GET  ?ids=a,b,c           -> { mailed: { [docId]: ISO timestamp } }
 *   POST { docId, mailed }    -> { ok, mailed }
 */
export async function GET(req: NextRequest) {
  const ids = new Set(
    (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  try {
    await ensureDb();
    const rows = await db.select().from(checkMailed);
    const mailed: Record<string, string> = {};
    for (const r of rows) if (ids.has(r.docId)) mailed[r.docId] = r.mailedAt;
    return NextResponse.json({ mailed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { docId?: string; mailed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  if (!docId) return NextResponse.json({ error: "docId is required" }, { status: 400 });
  const mailed = Boolean(body.mailed);
  try {
    await ensureDb();
    if (mailed) {
      const session = await auth();
      const now = new Date().toISOString();
      await db
        .insert(checkMailed)
        .values({ docId, mailedAt: now, mailedBy: session?.user?.email ?? "" })
        .onConflictDoNothing();
    } else {
      await db.delete(checkMailed).where(eq(checkMailed.docId, docId));
    }
    return NextResponse.json({ ok: true, mailed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
