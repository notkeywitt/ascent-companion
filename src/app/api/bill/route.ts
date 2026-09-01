import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getBillDetail, getJobBudget, getCostToComplete } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { db, ensureDb } from "@/db";
import { savedBills } from "@/db/schema";

// Read-only: a draft bill's header + lines + attached files + the job's budget.
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json(
      { error: "JT_GRANT_KEY is not set. Add it to .env.local and restart." },
      { status: 400 },
    );
  }
  const docId = req.nextUrl.searchParams.get("docId")?.trim();
  // jobId is optional: it's only needed for the job's budget + CTC. The bill
  // itself knows its own job, so a link that arrives without ?jobId (some review
  // and digest links) still resolves — we read the bill, then use its job.
  const jobIdParam = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!docId) {
    return NextResponse.json({ error: "Pass ?docId=<bill id> (and optional &jobId=<job id>)" }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    // The bill first (it carries its own jobId); then the job's budget + CTC,
    // keyed on the passed jobId when present, else the bill's own job.
    const detail = await getBillDetail(cfg, docId);
    const jobId = jobIdParam || detail.jobId;
    // getBillDetail already fetched header+lines+files; budget leaves and the two
    // CTC aggregates are the remaining calls, skipped when the job is unknown.
    const [budget, costToComplete] = jobId
      ? await Promise.all([getJobBudget(cfg, jobId), getCostToComplete(cfg, jobId)])
      : [[], {}];

    // Assistant-local flags for this bill: saved (Save clicked) and reviewed
    // (explicitly marked done) — the same pair the coding queue shows. Best-effort.
    let reviewed = false;
    let saved = false;
    try {
      await ensureDb();
      const [row] = await db
        .select({ reviewed: savedBills.reviewed, savedAt: savedBills.savedAt })
        .from(savedBills)
        .where(eq(savedBills.docId, docId))
        .limit(1);
      reviewed = Boolean(row?.reviewed);
      saved = (row?.savedAt ?? "") !== "";
    } catch {
      /* flags are best-effort */
    }

    return NextResponse.json({
      header: detail.header,
      lines: detail.lines,
      budget,
      files: detail.files,
      costToComplete,
      // The bill's resolved job, so a page opened without ?jobId can adopt it for
      // its back link, coding-queue pager and neighbour prefetch.
      jobId,
      writesEnabled: writesEnabled(),
      reviewed,
      saved,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
