import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { listLedger, recordAdjustment } from "@/lib/leaveService";

/**
 * Office/admin — one employee's ledger, and manual adjustments. An adjustment
 * (or an opening-balance import row) is a signed `adjustment` ledger entry:
 * positive adds hours, negative subtracts. Companion-DB only.
 *
 * GET ?employeeId=<id>                                   → { ok, ledger }
 * POST { employeeId, jtUserId?, leaveType, hours, note } → { ok }
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const employeeId = (req.nextUrl.searchParams.get("employeeId") ?? "").trim();
  if (!employeeId) return NextResponse.json({ ok: false, error: "Pass ?employeeId=" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ledger: await listLedger(employeeId) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

interface PostBody {
  employeeId?: string;
  jtUserId?: string;
  leaveType?: string;
  hours?: number;
  note?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const actor = session?.user?.email ?? "office";
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const employeeId = (body.employeeId ?? "").trim();
  const leaveType = (body.leaveType ?? "").trim();
  const hours = Number(body.hours);
  if (!employeeId) return NextResponse.json({ ok: false, error: "employeeId is required." }, { status: 400 });
  if (leaveType !== "sick" && leaveType !== "pto") {
    return NextResponse.json({ ok: false, error: "leaveType must be 'sick' or 'pto'." }, { status: 400 });
  }
  if (!Number.isFinite(hours) || hours === 0) {
    return NextResponse.json({ ok: false, error: "hours must be a non-zero number." }, { status: 400 });
  }
  try {
    await recordAdjustment({
      employeeId,
      jtUserId: (body.jtUserId ?? "").trim(),
      leaveType,
      hours,
      note: (body.note ?? "").trim(),
      actor,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
