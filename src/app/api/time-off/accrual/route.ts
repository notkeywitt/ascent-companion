import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { runAccrual } from "@/lib/leaveService";

/**
 * Office/admin — run (or preview) accrual across all eligible employees, from
 * where each left off up through the last completed pay period. `commit=false`
 * previews without writing. This reads worked hours from JobTread and writes
 * ONLY to the companion DB — it never writes to JobTread, so it is safe with
 * COMPANION_WRITES_ENABLED off.
 *
 * POST { commit?: boolean, throughPeriod?: string } → AccrualResult
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  const actor = session?.user?.email ?? "office";
  let body: { commit?: boolean; throughPeriod?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body = preview with defaults */
  }
  try {
    const result = await runAccrual({
      commit: body.commit === true,
      throughPeriod: (body.throughPeriod ?? "").trim() || undefined,
      actor,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Accrual failed" }, { status: 500 });
  }
}
