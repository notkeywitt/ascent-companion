import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPolicyRows, updatePolicy } from "@/lib/leaveService";
import type { TenureTier } from "@/lib/leave";

// Office/admin — the accrual policy per leave type. Gated by the "time-off-admin"
// view (see lib/views). GET seeds defaults on first read.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, policies: await getPolicyRows() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

interface PatchBody {
  leaveType?: string;
  label?: string;
  hoursPerHourWorked?: number;
  annualCap?: number;
  carryoverCap?: number;
  waitingDays?: number;
  tenureTiers?: TenureTier[];
  active?: boolean;
}

export async function PATCH(req: NextRequest) {
  await auth();
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const leaveType = (body.leaveType ?? "").trim();
  if (leaveType !== "sick" && leaveType !== "pto") {
    return NextResponse.json({ ok: false, error: "leaveType must be 'sick' or 'pto'." }, { status: 400 });
  }
  try {
    await updatePolicy(leaveType, {
      label: body.label,
      hoursPerHourWorked: body.hoursPerHourWorked,
      annualCap: body.annualCap,
      carryoverCap: body.carryoverCap,
      waitingDays: body.waitingDays,
      tenureTiers: body.tenureTiers,
      active: body.active,
    });
    return NextResponse.json({ ok: true, policies: await getPolicyRows() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
