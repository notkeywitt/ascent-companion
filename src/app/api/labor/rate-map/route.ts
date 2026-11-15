import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { listJobCodeRates, saveJobCodeRate } from "@/lib/laborRateMap";

/**
 * The job labor-rate map (job + cost code → pay type). DB only, no JobTread
 * write. Office/admin-gated by the `labor` view's `/api/labor` prefix.
 *
 *   GET                                        → { rates }
 *   POST { jobId, jobName, costCode, payType } → { ok }  (upsert on job + code)
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rates: await listJobCodeRates() });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const rate = {
    jobId: String(b.jobId ?? "").trim(),
    jobName: String(b.jobName ?? "").trim(),
    costCode: String(b.costCode ?? "").trim(),
    payType: String(b.payType ?? "").trim(),
  };
  if (!rate.jobId || !rate.costCode || !rate.payType) {
    return NextResponse.json({ error: "Pass jobId, costCode and payType." }, { status: 400 });
  }
  const session = await auth();
  await saveJobCodeRate(rate, session?.user?.email ?? "");
  return NextResponse.json({ ok: true });
}
