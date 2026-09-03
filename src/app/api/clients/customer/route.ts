import { NextRequest, NextResponse } from "next/server";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getCustomerDetail, getCustomFields } from "@/lib/clientDirectory";

/** GET ?accountId= — one customer's whole JobTread record: account custom
 *  fields, every contact, every location. Read-only. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const accountId = (req.nextUrl.searchParams.get("accountId") ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const fields = await getCustomFields(cfg);
    const customer = await getCustomerDetail(cfg, accountId, fields);
    return NextResponse.json({ customer });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
