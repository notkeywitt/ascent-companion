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

    // Tag each bill with whether its coding has been saved from the Companion
    // (Save clicked). Best-effort — a DB hiccup must not break the queue.
    let saved = new Set<string>();
    try {
      await ensureDb();
      const ids = bills.map((b) => b.id).filter(Boolean);
      if (ids.length) {
        const rows = await db
          .select({ docId: savedBills.docId })
          .from(savedBills)
          .where(inArray(savedBills.docId, ids));
        saved = new Set(rows.map((r) => r.docId));
      }
    } catch {
      /* indicator is best-effort */
    }

    return NextResponse.json({ bills: bills.map((b) => ({ ...b, saved: saved.has(b.id) })) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
