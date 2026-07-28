import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { balancesForEmployee, employeeByEmail, getPolicyRows } from "@/lib/leaveService";

/**
 * Field self-service — the signed-in user's own Sick/PTO balances. Resolves the
 * Google email to a roster employee (Apps Script), then reads that employee's
 * balances from the companion DB. Gated by the field-visible "time-off" view.
 *
 * GET → { ok, me:{employeeId,name,jtUserId}|null, balances:[{leaveType,balance,
 *         accrued,used}], policies }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  try {
    // Return the active policy ROWS (which carry `active` + `label`), NOT the
    // internal AccrualPolicy shape — the field RequestForm's Type dropdown does
    // policies.filter(p => p.active), so a payload missing that flag renders an
    // empty dropdown. Mirrors what /api/time-off/balances sends the office.
    const policies = (await getPolicyRows()).filter((p) => p.active);
    const emp = await employeeByEmail(email);
    if (!emp) {
      return NextResponse.json({
        ok: true,
        me: null,
        balances: [],
        policies,
        note: "Your login isn't linked to an employee record yet — ask the office.",
      });
    }
    const balances = await balancesForEmployee(emp.employeeId);
    return NextResponse.json({
      ok: true,
      me: { employeeId: emp.employeeId, name: emp.name, jtUserId: emp.jtUserId },
      balances,
      policies,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
