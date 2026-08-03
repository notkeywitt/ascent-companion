import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getBillDetail, getBillFiles, getJobBudget, getCostToComplete } from "@/lib/jobtread";
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
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!docId || !jobId) {
    return NextResponse.json({ error: "Pass ?docId=<bill id>&jobId=<job id>" }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const [detail, budget, files, costToComplete] = await Promise.all([
      getBillDetail(cfg, docId),
      getJobBudget(cfg, jobId),
      getBillFiles(cfg, docId),
      getCostToComplete(cfg, jobId),
    ]);

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
      files,
      costToComplete,
      writesEnabled: writesEnabled(),
      reviewed,
      saved,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
