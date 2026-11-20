import { NextResponse } from "next/server";
import { getUnpaidBillsSince } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { UNPAID_BILLS_FROM, buildUnpaidBills } from "@/lib/unpaidBills";

/**
 * UNPAID BILLS — read-only, for Home's Unpaid bills widget. Every vendor bill
 * dated from `UNPAID_BILLS_FROM` on that is unpaid or part paid, newest first
 * (see `src/lib/unpaidBills.ts`). Gated by the `accounts-payable` view.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const rows = await getUnpaidBillsSince(getPaveConfig(), UNPAID_BILLS_FROM);
    return NextResponse.json(buildUnpaidBills(rows));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
