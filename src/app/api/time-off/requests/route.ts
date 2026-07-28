import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveAllowedViews } from "@/lib/views";
import {
  createLeaveRequest,
  decideLeaveRequest,
  employeeByEmail,
  listRequests,
} from "@/lib/leaveService";

/**
 * Time-off requests. The page + this route are behind the field-visible
 * "time-off" view, so field employees reach their OWN requests here; the
 * office/admin powers (list everyone, approve/deny) are authorized in-handler by
 * checking the caller resolves the "time-off-admin" view — middleware can't
 * split those by HTTP method on one path.
 *
 * GET               → { ok, requests }  (own; office may pass ?scope=all)
 * POST {leaveType,startDate,endDate,hours,note}         → { ok, id }
 * PATCH {id, action:"approve"|"deny"}   (office/admin)  → { ok }
 */
export const dynamic = "force-dynamic";

async function callerIsOffice(): Promise<boolean> {
  const session = await auth();
  const u = session?.user;
  if (!u) return false;
  return resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny).has("time-off-admin");
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const scope = (req.nextUrl.searchParams.get("scope") ?? "").trim();
  try {
    if (scope === "all") {
      if (!(await callerIsOffice())) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ ok: true, requests: await listRequests({}) });
    }
    const emp = await employeeByEmail(email);
    if (!emp) return NextResponse.json({ ok: true, requests: [] });
    return NextResponse.json({ ok: true, requests: await listRequests({ employeeId: emp.employeeId }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

interface PostBody {
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  hours?: number;
  note?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const leaveType = (body.leaveType ?? "").trim();
  const startDate = (body.startDate ?? "").trim();
  const endDate = (body.endDate ?? "").trim() || startDate;
  const hours = Number(body.hours);
  if (leaveType !== "sick" && leaveType !== "pto") {
    return NextResponse.json({ ok: false, error: "leaveType must be 'sick' or 'pto'." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ ok: false, error: "Pick a start date." }, { status: 400 });
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json({ ok: false, error: "Enter the number of hours." }, { status: 400 });
  }
  try {
    const emp = await employeeByEmail(email);
    if (!emp) {
      return NextResponse.json(
        { ok: false, error: "Your login isn't linked to an employee record yet — ask the office." },
        { status: 400 },
      );
    }
    const { id } = await createLeaveRequest({
      employeeId: emp.employeeId,
      jtUserId: emp.jtUserId,
      leaveType,
      startDate,
      endDate,
      hours,
      note: (body.note ?? "").trim(),
      actor: email,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await callerIsOffice())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const session = await auth();
  const actor = session?.user?.email ?? "office";
  let body: { id?: number; action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const id = Number(body.id);
  const action = (body.action ?? "").trim();
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  if (action !== "approve" && action !== "deny") {
    return NextResponse.json({ ok: false, error: "action must be 'approve' or 'deny'." }, { status: 400 });
  }
  try {
    const r = await decideLeaveRequest({ id, approve: action === "approve", actor });
    if (!r.ok) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
