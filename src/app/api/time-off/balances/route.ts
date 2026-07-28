import { NextResponse } from "next/server";

import { fetchRoster, getPolicyRows, listBalances } from "@/lib/leaveService";

/**
 * Office/admin — every employee's current Sick/PTO balance, the policies, and
 * the roster (so the office can adjust/seed people who have no balance row yet).
 * Companion-DB read plus a roster fetch; touches nothing in JobTread.
 *
 * GET → { ok, balances:[{employeeId, name, leaveType, accrued, used, balance,
 *         accruedThroughPeriod}], policies, roster }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [balances, policies] = await Promise.all([listBalances(), getPolicyRows()]);
    // Roster is best-effort — the office UI still works from balances alone if
    // Apps Script is unreachable.
    let roster: Array<{ employeeId: string; name: string; jtUserId: string; hireDate: string; status: string }> = [];
    try {
      roster = await fetchRoster();
    } catch {
      roster = [];
    }
    const nameById = new Map(roster.map((r) => [r.employeeId, r.name]));
    const enriched = balances.map((b) => ({ ...b, name: nameById.get(String(b.employeeId)) ?? "" }));
    return NextResponse.json({ ok: true, balances: enriched, policies, roster });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
