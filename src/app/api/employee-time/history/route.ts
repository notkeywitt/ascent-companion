import { NextRequest, NextResponse } from "next/server";

import { getUserTimeEntries, jtIsoToOrgLocal } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { jtTimeUrl } from "@/lib/jtLinks";
import { resolveTimeIdentity } from "@/lib/actingAs";

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
 * Each row's jtUrl opens THAT ENTRY in JobTread —
 * app.jobtread.com/time?timeEntryId=… (owner-supplied address, 2026-09-17).
 * It used to be the employee's time page filtered to the row's job and day,
 * because an entry was thought not to be deep-linkable; it is. The URL shape
 * lives in lib/jtLinks.
 *
 * GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive, calendar-day range)
 *     &actingAs=<jtUserId>  — ADMIN ONLY: read that person's timesheet instead.
 *   → { ok, subject:{jtUserId,name,acting},
 *        entries:[{id, date, startTime, endTime, minutes, jobId, jobName,
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

  // WHOSE timesheet. Normally the signed-in person's, resolved server-side from
  // their login; `?actingAs` opens someone else's and is refused for anyone but
  // an admin (src/lib/actingAs.ts). Nobody can page through a colleague's hours
  // by editing a query param.
  const who = await resolveTimeIdentity((req.nextUrl.searchParams.get("actingAs") ?? "").trim());
  if (!who.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          who.status === 400
            ? "No linked JobTread user for your login — an admin can link you on the Employees page."
            : who.error,
      },
      who.status === 400 ? undefined : { status: who.status },
    );
  }
  const userId = who.identity.jtUserId;

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
        // THE ENTRY ITSELF — `?timeEntryId=` opens JobTread's time page with
        // this row selected, which beats the job-and-day filter it used to
        // carry (that landed you on a list to search again).
        jtUrl: jtTimeUrl({ entryId: e.id }),
      };
    });

    return NextResponse.json({
      ok: true,
      entries,
      totalMinutes,
      openCount,
      // Who these hours belong to, so the page can say so rather than implying
      // they are the reader's own.
      subject: { jtUserId: userId, name: who.identity.name, acting: who.identity.acting },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not load time entries." },
      { status: 502 },
    );
  }
}
