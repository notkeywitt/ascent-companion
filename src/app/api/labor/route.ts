import { NextRequest, NextResponse } from "next/server";
import { getOrgTimeEntriesForMonth, jtIsoToOrgLocal } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { addDays, isIsoDay, monthsTouched } from "@/lib/laborPeriod";

/**
 * Read-only: every job's time entries from `from` to `to` (org-local days,
 * inclusive) — the Labor page (/labor).
 *
 * The same org-wide read the monthly Labor Report and the Tracking Sheets
 * all-jobs labor list make (getOrgTimeEntriesForMonth), once per month the
 * range touches, then cut to the range by the org-local day. That read files
 * an entry by its UTC day, so the months one day either side are read too: a
 * Pacific evening on the 31st is the 1st in UTC.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  if (!isIsoDay(from) || !isIsoDay(to) || to < from) {
    return NextResponse.json({ error: "Pass from and to as YYYY-MM-DD." }, { status: 400 });
  }
  if (Date.parse(to) - Date.parse(from) > 62 * 86_400_000) {
    return NextResponse.json({ error: "Pick a range of two months or less." }, { status: 400 });
  }

  try {
    const cfg = getPaveConfig();
    const months = monthsTouched(addDays(from, -1), addDays(to, 1));
    const all = (await Promise.all(months.map(([y, m]) => getOrgTimeEntriesForMonth(cfg, y, m)))).flat();
    const entries = all
      .map((t) => ({ t, date: t.startedAt ? jtIsoToOrgLocal(t.startedAt).slice(0, 10) : "" }))
      .filter(({ date }) => date >= from && date <= to)
      .map(({ t, date }) => ({
        id: t.id,
        date,
        employee: t.employee,
        userId: t.userId,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        hours: t.hours,
        cost: t.cost,
        hourlyRate: t.hourlyRate,
        type: t.type,
        code: t.code,
        codeName: t.codeName,
        costItemId: t.costItemId,
        notes: t.notes,
        isApproved: t.isApproved,
        jobId: t.jobId,
        jobName: [t.customer, t.jobName].filter(Boolean).join(" — ") || "No job",
      }));
    return NextResponse.json({ from, to, writesEnabled: writesEnabled(), entries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
