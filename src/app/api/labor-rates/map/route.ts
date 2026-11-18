import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getJobBudget, isDivisionLevelCode } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { listCodeRates, saveCodeRate } from "@/lib/laborCodeRates";

/**
 * The Labor Rates Map (job + Labor cost code → hourly dollar rate). DB only, no
 * JobTread write. Office/admin-gated by the `labor-rates` view's prefix.
 *
 *   GET                              → { rates }
 *   GET ?jobId=…                     → { codes: [{ number, name, division }] }  the job's clock-in cost codes (Labor, Allowance, …)
 *   POST { jobId, costCode, hourlyRate }  → { ok }  (a null / blank rate clears the row)
 *   POST { jobId, costCodes: [...], hourlyRate }  → { ok }  the same rate on every code (a division)
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ rates: await listCodeRates() });
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const budget = await getJobBudget(getPaveConfig(), jobId);
    const seen = new Map<string, { name: string; division: string }>();
    for (const b of budget) {
      // Any code an employee can clock in under: Labor, Allowance, … (its cost type allows time entries).
      const clockable = b.timeTrackable === true || (b.costType ?? "").trim().toLowerCase() === "labor";
      if (!clockable || seen.has(b.number)) continue;
      const division = b.division || (isDivisionLevelCode(b.number) ? b.name : "") || "No division";
      seen.set(b.number, { name: b.name, division });
    }
    const codes = [...seen].map(([number, v]) => ({ number, ...v }));
    codes.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return NextResponse.json({ codes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const jobId = String(b.jobId ?? "").trim();
  const list: string[] = Array.isArray(b.costCodes)
    ? b.costCodes.map((c: unknown) => String(c ?? "").trim()).filter(Boolean)
    : [String(b.costCode ?? "").trim()].filter(Boolean);
  const blank = b.hourlyRate === null || b.hourlyRate === "";
  const hourlyRate = blank ? null : Number(b.hourlyRate);
  if (!jobId || list.length === 0 || (hourlyRate !== null && !(hourlyRate >= 0))) {
    return NextResponse.json({ error: "Pass jobId, costCode and a rate in dollars." }, { status: 400 });
  }
  const session = await auth();
  for (const costCode of list) await saveCodeRate(jobId, costCode, hourlyRate, session?.user?.email ?? "");
  return NextResponse.json({ ok: true });
}
