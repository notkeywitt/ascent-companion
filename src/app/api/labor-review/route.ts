import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
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
 * Labor Review — the time-entry half of what Client Invoicing does for bills.
 *
 * GET assembles everything the page needs for ONE job in ONE browser fetch, from
 * the same already-cached readers /api/recode uses, so the two pages can never
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

    return NextResponse.json({
      job: { id: jobId, name: header.name, address: header.address },
      timeEntries,
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

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { changes?: TimeChange[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const changes = (body.changes ?? []).filter((c) => c?.id && c?.costItemId);
  if (changes.length === 0) {
    return NextResponse.json({ error: "No time-entry recodes provided" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      changes,
    });
  }

  // Attribution comes from the session, never the body — same rule as /api/code.
  await auth();

  const cfg = getPaveConfig();
  const results: { id: string; ok: boolean; error?: string }[] = [];
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

  // Labor moved between cost codes, so every cached per-code total for this job
  // (this page's rail AND Client Invoicing's) is now stale.
  if (results.some((r) => r.ok)) clearJobCostCaches();

  return NextResponse.json({ previewed: false, wrote: true, results });
}
