import { NextResponse } from "next/server";

import { getPaveConfig, hasGrant } from "@/lib/config";
import { getOrgTimeEntries } from "@/lib/jobtread";

/**
 * GET /api/employees/clock-status → { ok, people: { [userName]: { state, job } } }
 * for the dot on the Employees list. READ-ONLY.
 *
 *   state "in"    — an open time entry (clocked in).
 *   state "break" — no open entry, and the last entry closed under BREAK_MIN
 *                   minutes ago. JobTread keeps no break flag: a break is the
 *                   gap between two entries (see api/employee-time/clock), so a
 *                   clock-out looks the same for the first hour.
 *   state "out"   — anything else.
 *   job           — the open entry's job, else the last entry's job.
 *
 * Looks back 14 days. Gated by the `employees` view (paths in src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

const BREAK_MIN = 60;
const LOOKBACK_DAYS = 14;

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    // Newest start first, so the first row seen for a person is their latest.
    const rows = await getOrgTimeEntries(getPaveConfig(), { sinceIso: since });
    const people: Record<string, { state: "in" | "break" | "out"; job: string }> = {};
    const now = Date.now();
    for (const e of rows) {
      if (!e.userName) continue;
      const job = e.customer && e.jobName ? `${e.customer} - ${e.jobName}` : e.jobName;
      const cur = people[e.userName];
      if (e.endedAt == null) {
        // An open entry always wins over a closed one.
        if (!cur || cur.state !== "in") people[e.userName] = { state: "in", job };
      } else if (!cur) {
        const ageMin = (now - new Date(e.endedAt).getTime()) / 60_000;
        people[e.userName] = { state: ageMin >= 0 && ageMin < BREAK_MIN ? "break" : "out", job };
      }
    }
    return NextResponse.json({ ok: true, people });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
