import { NextResponse } from "next/server";
import { getVendorBills } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: one vendor's bills — job, date, amount, status — for the
 * /vendors page. Deliberately NOT cached: a vendor lookup is a one-off
 * action, not a page every load hits, and bill status can change between
 * visits.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const bills = await getVendorBills(getPaveConfig(), id);
    return NextResponse.json({ bills });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
