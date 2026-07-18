import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/db";
import { savedBills } from "@/db/schema";

/**
 * Toggle the companion-local "reviewed" flag on a bill. This is NOT a JobTread
 * write — it only records that the office marked the bill reviewed/done — so it
 * works regardless of COMPANION_WRITES_ENABLED. Body: { docId, reviewed }.
 */
export async function POST(req: NextRequest) {
  let body: { docId?: string; reviewed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  if (!docId) return NextResponse.json({ error: "docId is required" }, { status: 400 });
  const reviewed = Boolean(body.reviewed);

  try {
    await ensureDb();
    const now = new Date().toISOString();
    await db
      .insert(savedBills)
      // savedAt/savedBy passed explicitly so a review-only row satisfies the
      // (pre-default) NOT NULL saved_at on already-shipped databases.
      .values({ docId, savedAt: "", savedBy: "", reviewed, reviewedAt: reviewed ? now : "" })
      .onConflictDoUpdate({
        target: savedBills.docId,
        set: { reviewed, reviewedAt: reviewed ? now : "" },
      });
    return NextResponse.json({ ok: true, reviewed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
