import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { flaggedTimeEntries } from "@/db/schema";

/**
 * Toggle the assistant-local "flag for review" mark on a time entry — the labor
 * twin of /api/bill-reviewed.
 *
 * This is NOT a JobTread write (JT has no such field on a time entry, and adding
 * one would fight the mirror), so it works regardless of COMPANION_WRITES_ENABLED
 * and needs none of the recode route's gating.
 *
 * Body: { id, jobId, flagged }.
 */
export async function POST(req: NextRequest) {
  let body: { id?: string; jobId?: string; flagged?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const jobId = (body.jobId ?? "").trim();
  const flagged = Boolean(body.flagged);

  // Attribution comes from the session, never the body — same rule as /api/code.
  const session = await auth();
  const who = session?.user?.email ?? "";

  try {
    await ensureDb();
    const now = new Date().toISOString();
    await db
      .insert(flaggedTimeEntries)
      .values({
        timeEntryId: id,
        jobId,
        flagged,
        flaggedAt: flagged ? now : "",
        flaggedBy: flagged ? who : "",
      })
      .onConflictDoUpdate({
        target: flaggedTimeEntries.timeEntryId,
        // jobId is rewritten too: an entry only ever belongs to one job, but a
        // row written before the id was known would otherwise stay unkeyed and
        // never come back with the job's flags.
        set: { jobId, flagged, flaggedAt: flagged ? now : "", flaggedBy: flagged ? who : "" },
      });
    return NextResponse.json({ ok: true, flagged });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
