import { NextResponse } from "next/server";

import { writesEnabled } from "@/lib/config";
import { listUnsyncedLeave } from "@/lib/leaveService";
import { listUnsyncedWorked } from "@/lib/timeSync";

/**
 * Office/admin — the reconciliation view. Lists every time record that was
 * captured (worked time in the Time Entries sheet; leave in the companion DB)
 * but hasn't reached JobTread yet, so nothing silently strands. Read-only.
 * Each source is best-effort so one being unreachable doesn't blank the other.
 *
 * GET → { ok, writesEnabled, worked:{rows,total,unsynced,error?}, leave:{rows,error?} }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const [workedRes, leaveRes] = await Promise.allSettled([listUnsyncedWorked(), listUnsyncedLeave()]);

  const worked =
    workedRes.status === "fulfilled"
      ? workedRes.value
      : { rows: [], total: 0, unsynced: 0, error: reason(workedRes.reason) };
  const leave =
    leaveRes.status === "fulfilled"
      ? { rows: leaveRes.value }
      : { rows: [], error: reason(leaveRes.reason) };

  return NextResponse.json({ ok: true, writesEnabled: writesEnabled(), worked, leave });
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : "Failed to load.";
}
