import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { getAllBillsForMonth } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { db, ensureDb } from "@/db";
import { savedBills } from "@/db/schema";

/**
 * Read-only: every vendor bill issued in a billing month, across ALL jobs, as a
 * flat list — the no-job "all bills for the month" view of Tracking Sheets. One
 * org-wide paged query (see getAllBillsForMonth), so it doesn't fan out a fetch
 * per job. Drafts are included by default (what's still coding, shop-wide);
 * invoiced bills drop unless includeInvoiced=1.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const now = new Date();
  const year = Number(p.get("year")) || now.getFullYear();
  const month = Number(p.get("month")) || now.getMonth() + 1;
  const includeInvoiced = p.get("includeInvoiced") === "1";
  const includeDrafts = p.get("includeDrafts") !== "0"; // drafts on by default

  try {
    const cfg = getPaveConfig();
    const bills = await getAllBillsForMonth(cfg, year, month, { includeInvoiced, includeDrafts });

    // Attach the companion-local per-bill flags the list renders: "Needs
    // review" (a correction the office has to make) and "reviewed" (the bill
    // card's coding-done toggle, which the row's stripe reads on a draft — see
    // billInvoiceState). One read of the bills carrying either flag, then a
    // lookup per bill.
    let flagged = new Set<string>();
    let reviewed = new Set<string>();
    try {
      await ensureDb();
      const rows = await db
        .select({
          docId: savedBills.docId,
          needsReview: savedBills.needsReview,
          reviewed: savedBills.reviewed,
        })
        .from(savedBills)
        .where(or(eq(savedBills.needsReview, true), eq(savedBills.reviewed, true)));
      flagged = new Set(rows.filter((r) => r.needsReview).map((r) => r.docId));
      reviewed = new Set(rows.filter((r) => r.reviewed).map((r) => r.docId));
    } catch {
      /* non-fatal — the list still renders, just without the review flags */
    }
    const tagged = bills.map((b) => ({
      ...b,
      needsReview: flagged.has(b.id),
      reviewed: reviewed.has(b.id),
    }));

    return NextResponse.json({
      bills: tagged,
      billTotal: tagged.reduce((s, b) => s + (b.cost ?? 0), 0),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
