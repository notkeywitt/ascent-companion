import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getUserTimeEntries, jtIsoToOrgLocal } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { callAppsScript } from "@/lib/appsScript";

/**
 * "My time" — the signed-in employee's own JobTread time entries for a date
 * range (the bi-monthly pay-period view on /employee-time). The employee's
 * JobTread user id is resolved server-side from their login email via the SAME
 * Apps Script action the logging page's bootstrap uses (timeEntryBootstrap) —
 * never trusted from the client — so nobody can page through someone else's
 * time by editing a query param.
 *
 * JobTread's timestamps are REAL UTC instants (confirmed live 2026-07-24 — see
 * the probe table above orgLocalToJtIso in @/lib/jobtread), so every stamp is
 * converted back to the org's local wall clock before its date/time is read.
 * Reading the digits literally, as this route used to, showed each entry 7 hours
 * off.
 *
 * Each row's jtUrl is the employee's own JobTread time page
 * (app.jobtread.com/time?userId=…), where they review/adjust their hours — not
 * the job page (an individual entry isn't deep-linkable).
 *
 * GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive, calendar-day range)
 *   → { ok, entries:[{id, date, startTime, endTime, jobId, jobName, costCode,
 *        costItemName, notes, open, jtUrl}], totalMinutes, openCount }
 */
export const dynamic = "force-dynamic";

function dateOf(iso: string): string {
  return jtIsoToOrgLocal(iso).slice(0, 10);
}
function timeOf(iso: string): string {
  const m = jtIsoToOrgLocal(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

// Memoize the signed-in email → JobTread user id resolution for a few minutes.
// The "My Time" view re-fetches on every month/half switch, and each load
// otherwise re-runs the Apps Script timeEntryBootstrap purely to map the email
// to its JT user id — a slow round trip for a value that only changes when an
// admin re-links the roster. Keyed by the AUTHENTICATED session email (never a
// client-supplied id), so this is a pure memoization, not a trust change; the
// short TTL bounds staleness after a re-link. Lives per warm server instance.
const _userIdByEmail = new Map<string, { userId: string; expires: number }>();
const USER_ID_TTL_MS = 5 * 60_000;

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

  // Resolve the email → JT user id from the short-lived memo when warm; only
  // hit Apps Script (timeEntryBootstrap) on a miss.
  let userId = "";
  const cached = email ? _userIdByEmail.get(email) : undefined;
  if (cached && cached.expires > Date.now()) {
    userId = cached.userId;
  } else {
    const boot = await callAppsScript({ action: "timeEntryBootstrap", email });
    if (boot.error) return NextResponse.json({ ok: false, error: boot.error }, { status: boot.status });
    const b = (boot.data ?? {}) as { ok?: boolean; error?: string; me?: { jtUserId?: string } };
    if (b?.ok === false) return NextResponse.json(b, { status: 200 });
    userId = (b.me?.jtUserId ?? "").trim();
    if (email && userId) _userIdByEmail.set(email, { userId, expires: Date.now() + USER_ID_TTL_MS });
  }
  if (!userId) {
    return NextResponse.json({
      ok: false,
      error: "No linked JobTread user for your login — an admin can link you on the Employees page.",
    });
  }

  // Every row links to the employee's own JobTread time page (all their entries
  // in one place), not the job page — the entry itself isn't deep-linkable, and
  // this is where they'd review/adjust their hours.
  const timeUrl = `https://app.jobtread.com/time?userId=${encodeURIComponent(userId)}`;

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
        const mins = Math.round(
          (new Date(e.endedAt as string).getTime() - new Date(e.startedAt).getTime()) / 60000,
        );
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
        costCode: e.costCode,
        costItemName: e.costItemName,
        notes: e.notes,
        open,
        jtUrl: timeUrl,
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
