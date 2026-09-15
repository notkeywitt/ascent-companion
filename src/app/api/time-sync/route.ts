import { NextRequest, NextResponse } from "next/server";

import { writesEnabled } from "@/lib/config";
import { listUnsyncedLeave } from "@/lib/leaveService";
import { auditWorked, listTimeProblems } from "@/lib/timeSync";

/**
 * Office/admin — the reconciliation view. Lists every time record that was
 * captured (worked time in the Time Entries sheet; leave in the companion DB)
 * but hasn't reached JobTread CORRECTLY, so nothing silently strands. Read-only.
 * Each source is best-effort so one being unreachable doesn't blank the other.
 *
 * TWO DEPTHS, because the cheap one misses the case employees actually report.
 * A refused clock-out leaves the entry OPEN in JobTread with the wrong hours,
 * and it carries an id, so "no JobTread id" never sees it. See lib/timeSync.
 *
 *   GET             → the sheet's own verdict PLUS a JobTread cross-check of the
 *                     last `days` days (default 7). One paged JobTread read.
 *   GET ?deep=0     → the sheet alone, no JobTread call. Faster, fewer answers.
 *   GET ?count=1    → { ok, count } only — the launcher badge, sheet-only.
 *
 *   → { ok, writesEnabled, worked:{rows,total,unsynced,problems,checked,from,to,
 *       error?,jtError?}, leave:{rows,error?} }
 */
export const dynamic = "force-dynamic";
// Reads the whole Time Entries sheet through Apps Script and then a window of
// JobTread, so give it the same budget as the other sheet-backed routes rather
// than the short platform default.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  // The badge. Sheet only, and nothing but the number — it runs on every home
  // page load, so it must never cost a JobTread read.
  if (q.get("count") === "1") {
    try {
      const { problems } = await listTimeProblems();
      return NextResponse.json({ ok: true, count: problems });
    } catch (e) {
      // A badge that can't count is a badge that shows nothing, never an error
      // banner over the launcher.
      return NextResponse.json({ ok: true, count: 0, error: reason(e) });
    }
  }

  const deep = q.get("deep") !== "0";
  const days = Number(q.get("days"));
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(90, Math.trunc(days)) : undefined;

  const [workedRes, leaveRes] = await Promise.allSettled([
    deep ? auditWorked({ windowDays }) : listTimeProblems(),
    listUnsyncedLeave(),
  ]);

  const worked =
    workedRes.status === "fulfilled" ? workedRes.value : { rows: [], total: 0, unsynced: 0, error: reason(workedRes.reason) };
  const leave =
    leaveRes.status === "fulfilled" ? { rows: leaveRes.value } : { rows: [], error: reason(leaveRes.reason) };

  return NextResponse.json({ ok: true, writesEnabled: writesEnabled(), worked, leave });
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : "Failed to load.";
}
