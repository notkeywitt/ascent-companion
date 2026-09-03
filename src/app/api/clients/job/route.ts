import { NextRequest, NextResponse } from "next/server";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getCustomFields, getJobDetail } from "@/lib/clientDirectory";

/** GET ?jobId= — one job's whole JobTread record, including its custom fields,
 *  its site location and JobTread's own cost figures. Read-only. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = (req.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const fields = await getCustomFields(cfg);
    const job = await getJobDetail(cfg, jobId, fields);
    return NextResponse.json({ job });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
