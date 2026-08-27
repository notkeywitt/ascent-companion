import { NextRequest, NextResponse } from "next/server";
import { getAllBillsForMonth } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

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
    return NextResponse.json({
      bills,
      billTotal: bills.reduce((s, b) => s + (b.cost ?? 0), 0),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
