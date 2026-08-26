import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { balancesForEmployee, employeeByEmail, getPolicyRows } from "@/lib/leaveService";
import { readJtUserLink } from "@/lib/jtUserLink";

/**
 * Field self-service — the signed-in user's own Sick/PTO balances. Resolves the
 * Google email to a roster employee, then reads that employee's balances from
 * the companion DB. Gated by the field-visible "time-off" view.
 *
 * The email → employee step prefers the cached roster link (lib/jtUserLink): it
 * is one DB read, where pulling the roster from Apps Script to translate an
 * email costs ~3 s. The roster pull stays as the fallback for a cold link, and
 * it is what fills the cache in the first place.
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
    const link = await readJtUserLink(email);
    const emp =
      link?.employeeId
        ? { employeeId: link.employeeId, name: link.name, jtUserId: link.jtUserId }
        : await employeeByEmail(email);
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
