import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant } from "@/lib/config";
import { getUntaxedLines } from "@/lib/jobtread";
import { currentBillingPeriod } from "@/lib/billingMonth";
import { parseBillingYm } from "@/lib/billing";
import { buildTaxableLinesReport } from "@/lib/taxableLines";

/**
 * THE STRAY `isTaxable: false` WORKLIST — read-only.
 *
 * A client invoice taxes only the lines that carry the flag, so one cleared by
 * mistake under-bills the client sales tax Ascent still owes the state. This
 * lists the month's flagged bill lines and links to each bill; a person makes
 * the change. Nothing here writes, deliberately — whether a cost is taxable is
 * a tax decision, and a bulk update across live bills is the wrong shape for
 * one. See src/lib/taxableLines.ts.
 *
 *   GET ?ym=YYYY-MM   → the month's candidates. Omit ym for the month in force.
 *
 * One org-wide cursor walk of the month's cost items, so it runs in seconds
 * rather than the tens the invoicing package needs.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const raw = req.nextUrl.searchParams.get("ym");
  if (raw && !parseBillingYm(raw)) {
    return NextResponse.json({ error: "ym must look like 2026-08." }, { status: 400 });
  }
  const period = parseBillingYm(raw) ?? (await currentBillingPeriod());
  const ym = `${period.billingYear}-${String(period.billingMonthNum).padStart(2, "0")}`;

  try {
    const lines = await getUntaxedLines(
      getPaveConfig(),
      period.billingYear,
      period.billingMonthNum,
    );
    return NextResponse.json(buildTaxableLinesReport(ym, lines));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
