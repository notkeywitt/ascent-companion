import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb, rawDb } from "@/db";
import { savedBills } from "@/db/schema";

/**
 * The companion-local "Needs review" flag + note on a bill — for a billing
 * correction the app can't make itself (a paid / invoiced / QuickBooks-pushed
 * bill that needs work in JobTread or QuickBooks directly). It only records that
 * someone flagged the bill and why, so — like /api/bill-reviewed and the labor
 * flag — it is NOT a JobTread write and works regardless of COMPANION_WRITES_ENABLED.
 *
 *   POST { docId, needsReview, note? } → set/clear the flag (and store the note).
 *   GET  ?docId=…                      → this bill's { needsReview, note, ... }.
 *   GET  (no docId)                    → every flagged bill, enriched from the
 *                                        local bill-search index for the queue.
 */
export async function POST(req: NextRequest) {
  let body: { docId?: string; needsReview?: boolean; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  if (!docId) return NextResponse.json({ error: "docId is required" }, { status: 400 });
  const needsReview = Boolean(body.needsReview);
  // Keep the note when clearing the flag would be surprising, so a cleared bill
  // loses its note (the issue is resolved); a still-flagged one keeps what was typed.
  const note = needsReview ? (body.note ?? "").trim().slice(0, 2000) : "";

  // Attribution comes from the session, never the body — same rule as /api/bill-reviewed.
  const session = await auth();
  const who = session?.user?.email ?? "";

  try {
    await ensureDb();
    const now = new Date().toISOString();
    await db
      .insert(savedBills)
      // saved_at/saved_by passed explicitly so a review-only row satisfies the
      // (pre-default) NOT NULL saved_at on already-shipped databases.
      .values({
        docId,
        savedAt: "",
        savedBy: "",
        needsReview,
        reviewNote: note,
        reviewFlaggedAt: needsReview ? now : "",
        reviewFlaggedBy: needsReview ? who : "",
      })
      .onConflictDoUpdate({
        target: savedBills.docId,
        set: {
          needsReview,
          reviewNote: note,
          reviewFlaggedAt: needsReview ? now : "",
          reviewFlaggedBy: needsReview ? who : "",
        },
      });
    return NextResponse.json({ ok: true, needsReview, note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const docId = (req.nextUrl.searchParams.get("docId") ?? "").trim();
  try {
    await ensureDb();

    // One bill's current flag + note — what the bill page loads to render its control.
    if (docId) {
      const row = (
        await db.select().from(savedBills).where(eq(savedBills.docId, docId)).limit(1)
      )[0];
      return NextResponse.json({
        needsReview: !!row?.needsReview,
        note: row?.reviewNote ?? "",
        flaggedAt: row?.reviewFlaggedAt ?? "",
        flaggedBy: row?.reviewFlaggedBy ?? "",
      });
    }

    // The whole queue: every flagged bill, joined to the local bill-search index
    // (vendor / amount / job / customer) so it reads without a JobTread fan-out.
    // A bill not yet in the index still lists — it just shows its id.
    const res = await rawDb().execute(`
      SELECT sb.doc_id       AS docId,
             sb.review_note  AS note,
             sb.review_flagged_at AS flaggedAt,
             sb.review_flagged_by AS flaggedBy,
             bi.vendor       AS vendor,
             bi.amount       AS amount,
             bi.status       AS status,
             bi.issue_date   AS issueDate,
             bi.job_id       AS jobId,
             bi.job_name     AS jobName,
             bi.customer     AS customer
        FROM saved_bills sb
        LEFT JOIN bill_index bi ON bi.jt_doc_id = sb.doc_id
       WHERE sb.needs_review = 1
       ORDER BY sb.review_flagged_at DESC
    `);
    const bills = res.rows.map((r) => ({
      docId: String(r.docId ?? ""),
      note: String(r.note ?? ""),
      flaggedAt: String(r.flaggedAt ?? ""),
      flaggedBy: String(r.flaggedBy ?? ""),
      vendor: r.vendor == null ? "" : String(r.vendor),
      amount: r.amount == null ? null : Number(r.amount),
      status: r.status == null ? "" : String(r.status),
      issueDate: r.issueDate == null ? "" : String(r.issueDate),
      jobId: r.jobId == null ? "" : String(r.jobId),
      jobName: r.jobName == null ? "" : String(r.jobName),
      customer: r.customer == null ? "" : String(r.customer),
    }));
    return NextResponse.json({ bills });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
