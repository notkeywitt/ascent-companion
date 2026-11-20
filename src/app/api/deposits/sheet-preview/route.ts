import { NextRequest, NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { writeDepositSheet } from "@/lib/depositRead";

/**
 * DRY RUN of the tracking sheet's Deposits tab (deposits stage 3).
 *
 * GET ?jobId=<JobTread job id>&ym=YYYY-MM → what appscript `writeTrackingDeposits`
 * would write, with `dryRun: true`. Writes nothing. `{ ok:true, skipped:true }`
 * means the job has no deposit or no tracking sheet.
 *
 * Gated by the `recode` view's `/api/deposits` path.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  const ym = req.nextUrl.searchParams.get("ym")?.trim() ?? "";
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return NextResponse.json({ error: "Pass ym as YYYY-MM" }, { status: 400 });
  const r = await writeDepositSheet({ jtJobId: jobId, ym, dryRun: true });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
