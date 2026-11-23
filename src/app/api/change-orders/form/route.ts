import { NextRequest, NextResponse } from "next/server";
import { getChangeOrderForm } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// The new-change-order form's data for one job: markup, tax rate, cost codes,
// cost types. Read only. GET ?jobId=<id>. Gated by the "change-orders" view.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  try {
    const f = await getChangeOrderForm(getPaveConfig(), jobId);
    return NextResponse.json({
      markup: f.markup,
      taxRate: f.header.taxRate,
      codes: f.codes,
      costTypes: f.costTypes,
      defaultCostTypeId: f.defaultCostTypeId,
      writes: writesEnabled(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
