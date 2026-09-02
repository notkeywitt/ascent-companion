import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { flaggedTimeEntries } from "@/db/schema";
import {
  clearJobCostCaches,
  getJobBudget,
  getJobCostDetail,
  getJobHeaderInfo,
  getJobTimeEntriesForMonth,
  updateTimeEntry,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Labor Review — the time-entry half of what Tracking Sheets does for bills.
 *
 * GET assembles everything the page needs for ONE job in ONE browser fetch, from
 * the same already-cached readers /api/trackingsheet uses, so the two pages can never
 * disagree about a job's budget:
 *  - getJobTimeEntriesForMonth — the month's entries (the middle column)
 *  - getJobCostDetail          — per-cost-code budget/bills/labor (the left rail)
 *  - getJobBudget              — the budget leaves, i.e. the legal coding targets
 *  - getJobHeaderInfo          — job name/address
 *
 * POST re-codes entries: `updateTimeEntry(id, { costItemId })`, the exact
 * analogue of /api/code's `updateLine(id, { jobCostItemId })` for a bill line.
 * Confirmed live before this route existed — see the note on updateTimeEntry:
 * cost, minutes, pay type and approval survive a recode untouched, so this moves
 * labor between cost codes without changing any amount.
 *
 * POST also APPROVES entries — `approvals: [id, …]` writes `isApproved: true`
 * and nothing else. It rides this route rather than a new one because it is the
 * same shape of job: a selection of entries, one write each, one result list
 * back. The two halves are independent — a body may carry either or both — and
 * an approval never touches an entry's coding, hours or cost.
 *
 * DRY_RUN-equivalent: like every other write route here, it respects
 * writesEnabled() and returns a preview instead of writing when the gate is off.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const jobId = p.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });

  const now = new Date();
  const y = Number(p.get("year")) || now.getFullYear();
  const m = Number(p.get("month")) || now.getMonth() + 1;

  try {
    const cfg = getPaveConfig();
    const [timeEntries, budget, costDetail, header] = await Promise.all([
      getJobTimeEntriesForMonth(cfg, jobId, y, m),
      getJobBudget(cfg, jobId),
      getJobCostDetail(cfg, jobId),
      getJobHeaderInfo(cfg, jobId),
    ]);

    // Assistant-side "flag for review" marks for this job. Best-effort — a DB
    // hiccup must leave the page loading, just without the flags.
    const flagged = new Set<string>();
    try {
      await ensureDb();
      const rows = await db
        .select({ id: flaggedTimeEntries.timeEntryId })
        .from(flaggedTimeEntries)
        .where(and(eq(flaggedTimeEntries.jobId, jobId), eq(flaggedTimeEntries.flagged, true)));
      for (const r of rows) flagged.add(r.id);
    } catch {
      /* flags are best-effort */
    }

    return NextResponse.json({
      job: { id: jobId, name: header.name, address: header.address, customer: header.customer },
      timeEntries: timeEntries.map((t) => ({ ...t, flagged: flagged.has(t.id) })),
      budget,
      costDetail,
      writesEnabled: writesEnabled(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

interface TimeChange {
  id: string; // timeEntryId
  costItemId: string; // the budget leaf to re-point it to
}

/** One write's outcome, per entry — recodes and approvals share the shape. */
interface WriteResult {
  id: string;
  ok: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { changes?: TimeChange[]; approvals?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const changes = (body.changes ?? []).filter((c) => c?.id && c?.costItemId);
  // De-duplicated: the same id twice would write twice for one press.
  const approvals = [...new Set((body.approvals ?? []).map((id) => id?.trim()).filter(Boolean))];
  if (changes.length === 0 && approvals.length === 0) {
    return NextResponse.json({ error: "No time-entry recodes or approvals provided" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      changes,
      approvals,
    });
  }

  // Attribution comes from the session, never the body — same rule as /api/code.
  await auth();

  const cfg = getPaveConfig();
  const results: WriteResult[] = [];
  for (const c of changes) {
    try {
      await updateTimeEntry(cfg, c.id, { costItemId: c.costItemId });
      results.push({ id: c.id, ok: true });
    } catch (e) {
      results.push({
        id: c.id,
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  // The approvals, reported separately: a caller that sent both needs to know
  // which half failed, and "3 recoded, 1 approval rejected" is unreadable from
  // one merged list.
  const approved: WriteResult[] = [];
  for (const id of approvals) {
    try {
      await updateTimeEntry(cfg, id, { isApproved: true });
      approved.push({ id, ok: true });
    } catch (e) {
      approved.push({ id, ok: false, error: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  // Labor moved between cost codes, so every cached per-code total for this job
  // (this page's rail AND Tracking Sheets') is now stale. An approval counts
  // too: the rail can be read approved-only, so the mark changes the figures.
  if ([...results, ...approved].some((r) => r.ok)) clearJobCostCaches();

  return NextResponse.json({ previewed: false, wrote: true, results, approved });
}
