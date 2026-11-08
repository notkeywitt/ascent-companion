import { NextResponse } from "next/server";
import { getLastAmazonBillMonth } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// No request input, so Next would otherwise prerender this at build time.
export const dynamic = "force-dynamic";

/**
 * Read-only: the newest month an Amazon import filed bills into, for the Home
 * reminder "Import Amazon for <month>". Gated by the `amazon-import` view's
 * `/api/amazon-import` prefix, the same view the reminder is shown to.
 *
 * GET → { month }  ("YYYY-MM", or "" for never)
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    return NextResponse.json({ month: await getLastAmazonBillMonth(getPaveConfig()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
