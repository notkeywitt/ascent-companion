import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { getDraftBills, getAllDraftBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { db, ensureDb } from "@/db";
import { savedBills } from "@/db/schema";

// Read-only (Phase A): draft vendor bills = the coding queue. With ?jobId=…,
// that job's drafts; with no job, every job's drafts (each tagged with its job).
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json(
      { error: "JT_GRANT_KEY is not set. Add it to .env.local and restart." },
      { status: 400 },
    );
  }
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  try {
    const cfg = getPaveConfig();
    const bills = jobId ? await getDraftBills(cfg, jobId) : await getAllDraftBills(cfg);

    // Newest first. issueDate is yyyy-MM-dd, so string compare orders it;
    // undated bills sink to the bottom.
    bills.sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));

    // Tag each bill with its companion-side flags: saved (Save clicked) and
    // reviewed (explicitly marked done). Best-effort — a DB hiccup must not
    // break the queue.
    const flags = new Map<string, { saved: boolean; reviewed: boolean }>();
    try {
      await ensureDb();
      const ids = bills.map((b) => b.id).filter(Boolean);
      if (ids.length) {
        const rows = await db
          .select({
            docId: savedBills.docId,
            savedAt: savedBills.savedAt,
            reviewed: savedBills.reviewed,
          })
          .from(savedBills)
          .where(inArray(savedBills.docId, ids));
        for (const r of rows) {
          flags.set(r.docId, { saved: (r.savedAt ?? "") !== "", reviewed: Boolean(r.reviewed) });
        }
      }
    } catch {
      /* indicators are best-effort */
    }

    return NextResponse.json({
      bills: bills.map((b) => ({
        ...b,
        saved: flags.get(b.id)?.saved ?? false,
        reviewed: flags.get(b.id)?.reviewed ?? false,
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
