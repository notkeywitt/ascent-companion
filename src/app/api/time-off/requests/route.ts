import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveAllowedViews } from "@/lib/views";
import {
  createLeaveRequest,
  decideLeaveRequest,
  deleteLeaveRequest,
  employeeByEmail,
  listRequests,
  notifyOfficeOfLeaveRequest,
  repostLeaveRequest,
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
 * PATCH {id, action}  (office/admin)  → { ok, ... }
 *   action: "approve" | "deny"   — decide a pending request
 *           "repost"             — retry the JobTread post for an approved one
 *           "delete"             — remove it, hand back the balance, delete the
 *                                  linked JobTread time entry
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
    const note = (body.note ?? "").trim();
    const { id } = await createLeaveRequest({
      employeeId: emp.employeeId,
      jtUserId: emp.jtUserId,
      leaveType,
      startDate,
      endDate,
      hours,
      note,
      actor: email,
    });
    // Notify the office. Best-effort by contract — the request is already
    // saved, so a mail failure must not fail the submission.
    const notified = await notifyOfficeOfLeaveRequest({
      employeeName: emp.name,
      employeeEmail: emp.email,
      leaveType,
      startDate,
      endDate,
      hours,
      note,
    });
    return NextResponse.json({ ok: true, id, notified }, { status: 201 });
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
  if (!["approve", "deny", "repost", "delete"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "action must be 'approve', 'deny', 'repost', or 'delete'." },
      { status: 400 },
    );
  }
  try {
    // repost: retry the JobTread post for an approved-but-unposted request.
    if (action === "repost") {
      const r = await repostLeaveRequest({ id, actor });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    // delete: remove the request, hand back the balance, delete the JT entry.
    if (action === "delete") {
      const r = await deleteLeaveRequest({ id, actor });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    const r = await decideLeaveRequest({ id, approve: action === "approve", actor });
    if (!r.ok) return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r); // carries jtPosted / jtStatus / jtError
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
