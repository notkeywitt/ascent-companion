import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getOrgTimeEntriesForMonth } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { db, ensureDb } from "@/db";
import { flaggedTimeEntries } from "@/db/schema";

/**
 * Read-only: every job's time entries in one month — the labor list on the
 * all-jobs view of Tracking Sheets, beside the month's bills (all-bills).
 *
 * The same org-wide read the monthly Labor Report makes
 * (getOrgTimeEntriesForMonth), so the two cannot disagree about the month.
 * Each entry carries its job and the companion-local review flag, the same
 * flag the per-job labor list shows. Newest first, like the per-job list.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const now = new Date();
  const year = Number(p.get("year")) || now.getFullYear();
  const month = Number(p.get("month")) || now.getMonth() + 1;

  try {
    const entries = await getOrgTimeEntriesForMonth(getPaveConfig(), year, month);

    // Best-effort: a DB hiccup leaves the list loading, just without flags.
    const flagged = new Set<string>();
    try {
      await ensureDb();
      const rows = await db
        .select({ id: flaggedTimeEntries.timeEntryId })
        .from(flaggedTimeEntries)
        .where(eq(flaggedTimeEntries.flagged, true));
      for (const r of rows) flagged.add(r.id);
    } catch {
      /* flags are best-effort */
    }

    const timeEntries = entries
      .map((t) => ({
        id: t.id,
        employee: t.employee,
        userId: t.userId,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        hours: t.hours,
        cost: t.cost,
        code: t.code,
        codeName: t.codeName,
        notes: t.notes,
        isApproved: t.isApproved,
        costItemId: t.costItemId,
        type: t.type,
        flagged: flagged.has(t.id),
        jobId: t.jobId,
        jobName: [t.customer, t.jobName].filter(Boolean).join(" — ") || "No job",
      }))
      .sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));

    return NextResponse.json({ timeEntries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
