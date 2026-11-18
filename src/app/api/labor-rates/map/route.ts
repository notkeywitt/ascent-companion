import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getJobBudget } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { listCodeRates, saveCodeRate } from "@/lib/laborCodeRates";

/**
 * The Labor Rates Map (job + Labor cost code → hourly dollar rate). DB only, no
 * JobTread write. Office/admin-gated by the `labor-rates` view's prefix.
 *
 *   GET                              → { rates }
 *   GET ?jobId=…                     → { codes: [{ number, name }] }  the job's Labor cost codes
 *   POST { jobId, costCode, hourlyRate }  → { ok }  (a null / blank rate clears the row)
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ rates: await listCodeRates() });
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const budget = await getJobBudget(getPaveConfig(), jobId);
    const seen = new Map<string, string>();
    for (const b of budget) {
      if ((b.costType ?? "").trim().toLowerCase() === "labor" && !seen.has(b.number)) seen.set(b.number, b.name);
    }
    const codes = [...seen].map(([number, name]) => ({ number, name }));
    codes.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return NextResponse.json({ codes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const jobId = String(b.jobId ?? "").trim();
  const costCode = String(b.costCode ?? "").trim();
  const blank = b.hourlyRate === null || b.hourlyRate === "";
  const hourlyRate = blank ? null : Number(b.hourlyRate);
  if (!jobId || !costCode || (hourlyRate !== null && !(hourlyRate >= 0))) {
    return NextResponse.json({ error: "Pass jobId, costCode and a rate in dollars." }, { status: 400 });
  }
  const session = await auth();
  await saveCodeRate(jobId, costCode, hourlyRate, session?.user?.email ?? "");
  return NextResponse.json({ ok: true });
}
