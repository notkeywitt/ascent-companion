import { NextRequest, NextResponse } from "next/server";
import { getAllBillsForMonth } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { parseBillingYm } from "@/lib/billing";
import { buildPayables } from "@/lib/accountsPayable";

/**
 * ACCOUNTS PAYABLE — read-only. Every vendor bill in a billing month
 * (`?ym=2026-10`), drafts and invoiced bills included, with Sunset and
 * Expenses left out (see `src/lib/accountsPayable.ts`). One org-wide
 * `getAllBillsForMonth` walk.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const period = parseBillingYm(req.nextUrl.searchParams.get("ym"));
  if (!period) {
    return NextResponse.json({ error: "ym must be a month, e.g. 2026-10." }, { status: 400 });
  }
  try {
    const rows = await getAllBillsForMonth(getPaveConfig(), period.billingYear, period.billingMonthNum, {
      includeInvoiced: true,
      includeDrafts: true,
    });
    return NextResponse.json(buildPayables(rows));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
