import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getUserTimeEntries, jtIsoToOrgLocal } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { jtTimeUrl } from "@/lib/jtLinks";
import { resolveJtUserLink } from "@/lib/jtUserLink";

/**
 * "My time" — the signed-in employee's own JobTread time entries for a date
 * range (the bi-monthly pay-period view on /employee-time). The employee's
 * JobTread user id is resolved server-side from their login email (the shared,
 * DB-backed roster link — lib/jtUserLink) and never trusted from the client, so
 * nobody can page through someone else's time by editing a query param.
 *
 * JobTread's timestamps are REAL UTC instants (confirmed live 2026-07-24 — see
 * the probe table above orgLocalToJtIso in @/lib/jobtread), so every stamp is
 * converted back to the org's local wall clock before its date/time is read.
 * Reading the digits literally, as this route used to, showed each entry 7 hours
 * off.
 *
 * Each row's jtUrl is the employee's own JobTread time page, narrowed to THAT
 * ROW'S DAY (app.jobtread.com/time?userId=…&startDate=…&endDate=…) — where they
 * review/adjust their hours, and not the job page (an individual entry isn't
 * deep-linkable). The URL shape lives in lib/jtLinks.
 *
 * GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive, calendar-day range)
 *   → { ok, entries:[{id, date, startTime, endTime, minutes, jobId, jobName,
 *        customer, costItemId, costCode, costItemName, payType, notes, approved,
 *        open, jtUrl}], totalMinutes, openCount }
 *
 * `costItemId` and `payType` ride along so the companion time-card editor can
 * preselect the entry's cost code and show its pay type when a row is tapped.
 *
 * `approved` is JobTread's own `timeEntry.isApproved` — the timesheet groups a
 * day as Approved only when every entry in it carries the mark.
 */
export const dynamic = "force-dynamic";

function dateOf(iso: string): string {
  return jtIsoToOrgLocal(iso).slice(0, 10);
}
function timeOf(iso: string): string {
  const m = jtIsoToOrgLocal(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const start = (req.nextUrl.searchParams.get("start") ?? "").trim();
  const end = (req.nextUrl.searchParams.get("end") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ ok: false, error: "start/end must be YYYY-MM-DD." }, { status: 400 });
  }

  const session = await auth();
  const email = session?.user?.email ?? "";

  // The email → JT user id comes from the shared DB-backed cache; only a cold
  // or stale link costs the Apps Script round trip.
  const link = await resolveJtUserLink(email);
  const userId = link?.jtUserId ?? "";
  if (!userId) {
    return NextResponse.json({
      ok: false,
      error: "No linked JobTread user for your login — an admin can link you on the Employees page.",
    });
  }

  try {
    // Bound the fetch server-side instead of pulling the worker's whole history
    // and discarding all but this ~15-day window. `start` is an org-local
    // (America/Los_Angeles, UTC-7/-8) calendar date, so its earliest possible
    // UTC instant is start+07:00Z — a lower bound of start-1day@00:00Z can never
    // clip an in-window entry, while dropping everything older. The client-side
    // dateOf() filter below still does the exact inclusive-day selection.
    const since = new Date(`${start}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 1);
    const all = await getUserTimeEntries(getPaveConfig(), userId, {
      sinceIso: since.toISOString(),
      sortDesc: true,
    });
    const inRange = all
      .filter((e) => {
        const d = dateOf(e.startedAt);
        return d >= start && d <= end;
      })
      .sort((a, c) => (a.startedAt < c.startedAt ? 1 : a.startedAt > c.startedAt ? -1 : 0)); // newest first

    let totalMinutes = 0;
    let openCount = 0;
    const entries = inRange.map((e) => {
      const open = !e.endedAt;
      let minutes = 0;
      if (open) {
        openCount++;
      } else {
        // JobTread's own `minutes` is the payroll number (a break deduction is
        // already taken out of it), so it wins over the raw start→end span; the
        // span is only the fallback for an entry JT reports 0 minutes for.
        const span = Math.round(
          (new Date(e.endedAt as string).getTime() - new Date(e.startedAt).getTime()) / 60000,
        );
        const mins = e.minutes > 0 ? e.minutes : span;
        if (Number.isFinite(mins) && mins > 0) {
          minutes = mins;
          totalMinutes += mins;
        }
      }
      return {
        id: e.id,
        date: dateOf(e.startedAt),
        startTime: timeOf(e.startedAt),
        endTime: open ? "" : timeOf(e.endedAt as string),
        minutes,
        jobId: e.jobId,
        jobName: e.jobName,
        customer: e.customer,
        costItemId: e.costItemId,
        costCode: e.costCode,
        costItemName: e.costItemName,
        payType: e.payType,
        notes: e.notes,
        approved: e.approved,
        open,
        // Narrowed to this entry's own day, so the link opens on the hours the
        // row is about rather than the employee's whole history.
        jtUrl: jtTimeUrl({ userId, from: dateOf(e.startedAt) }),
      };
    });

    return NextResponse.json({ ok: true, entries, totalMinutes, openCount });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not load time entries." },
      { status: 502 },
    );
  }
}
