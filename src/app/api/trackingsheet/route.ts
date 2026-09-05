import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { flaggedTimeEntries, savedBills } from "@/db/schema";
import {
  getBillLinesForJob,
  getJobBillsForMonth,
  getJobBudget,
  getJobCostDetail,
  getJobHeaderInfo,
  getJobPhaseMap,
  getJobTimeEntriesForMonth,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Read-only: everything the Invoicing coding board needs for ONE job in ONE
 * browser fetch — the month's bills, their individual lines, the droppable
 * coding targets, and the per-cost-code budget headroom.
 *
 * Assembled from functions that already exist and are already cached:
 *  - getUninvoicedBills — the month's bills (filters on issueDate within a plain
 *    calendar month, which IS the billing month; the 10th-to-10th rule is an
 *    ingestion convention, not a query).
 *  - getJobCostDetail  — per-cost-code budget/spent/invoiced (built for /jobs),
 *    which doubles as the board's compact tracking-sheet reference panel.
 *  - getJobBudget      — the budget leaves; their `id` is the jobCostItemId a
 *    recode targets, so this is the set of legal drop targets.
 *  - getBillLinesForJob — one walk for every line on those bills rather than a
 *    getBillDetail per bill.
 *  - getJobTimeEntriesForMonth — the month's time entries, for the Bills
 *    list's "Time & labor" block (labor billed alongside the vendor bills,
 *    same reasoning the cost-code rail already gives for counting it there).
 *
 * Invoiced bills are excluded by default: recoding a bill already on a customer
 * invoice changes numbers the client has been sent. `includeInvoiced=1` widens a
 * past, fully-invoiced month back into view for the board (which renders those
 * bills read-only) instead of leaving it empty next to its own Reconciled badge.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const jobId = p.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });

  const year = Number(p.get("year")) || undefined;
  const month = Number(p.get("month")) || undefined;
  const includeDrafts = p.get("includeDrafts") !== "0"; // drafts on by default
  const includeInvoiced = p.get("includeInvoiced") === "1";

  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;

  try {
    const cfg = getPaveConfig();

    // Bills first — their ids scope the line query. The others don't depend
    // on it, so they run alongside.
    const [bills, budget, costDetail, header, timeEntries] = await Promise.all([
      getJobBillsForMonth(cfg, jobId, y, m, includeDrafts, includeInvoiced),
      getJobBudget(cfg, jobId),
      getJobCostDetail(cfg, jobId),
      getJobHeaderInfo(cfg, jobId),
      getJobTimeEntriesForMonth(cfg, jobId, y, m),
    ]);
    const lines = await getBillLinesForJob(cfg, jobId, [...new Set(bills.map((b) => b.id))]);

    // Assistant-local flags, same set the coding queue shows: saved (Save
    // clicked), reviewed (explicitly marked done), and needsReview (flagged for
    // a billing correction). Best-effort — a DB hiccup must never fail the board.
    const flags = new Map<string, { saved: boolean; reviewed: boolean; needsReview: boolean }>();
    if (bills.length > 0) {
      try {
        await ensureDb();
        const rows = await db
          .select({
            docId: savedBills.docId,
            savedAt: savedBills.savedAt,
            reviewed: savedBills.reviewed,
            needsReview: savedBills.needsReview,
          })
          .from(savedBills)
          .where(
            inArray(
              savedBills.docId,
              bills.map((b) => b.id),
            ),
          );
        for (const r of rows) {
          flags.set(r.docId, {
            saved: (r.savedAt ?? "") !== "",
            reviewed: Boolean(r.reviewed),
            needsReview: Boolean(r.needsReview),
          });
        }
      } catch {
        /* flags are best-effort */
      }
    }

    // …and the labor twin of those flags: the assistant-local "flag for review"
    // marks on time entries. The board's Time & labor panel is now the same
    // component Labor Review renders, so it shows and sets the same flags —
    // which means this payload has to carry them too. Best-effort, like above.
    const flaggedTime = new Set<string>();
    try {
      await ensureDb();
      const rows = await db
        .select({ id: flaggedTimeEntries.timeEntryId })
        .from(flaggedTimeEntries)
        .where(and(eq(flaggedTimeEntries.jobId, jobId), eq(flaggedTimeEntries.flagged, true)));
      for (const r of rows) flaggedTime.add(r.id);
    } catch {
      /* flags are best-effort */
    }

    return NextResponse.json({
      // `phase` rides along because it is what says whether sales tax on this
      // job's bills is recoverable (src/lib/salesTax.ts). One cached org read.
      job: {
        id: jobId,
        name: header.name,
        address: header.address,
        customer: header.customer,
        phase: (await getJobPhaseMap(cfg).catch(() => ({}) as Record<string, string>))[jobId] ?? "",
      },
      bills: bills.map((b) => ({
        ...b,
        saved: flags.get(b.id)?.saved ?? false,
        reviewed: flags.get(b.id)?.reviewed ?? false,
        needsReview: flags.get(b.id)?.needsReview ?? false,
      })),
      billTotal: bills.reduce((s, b) => s + (b.cost ?? 0), 0),
      lines,
      timeEntries: timeEntries.map((t) => ({ ...t, flagged: flaggedTime.has(t.id) })),
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
