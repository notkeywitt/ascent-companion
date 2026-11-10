import { NextResponse } from "next/server";
import { getJobs } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { isIsoDay } from "@/lib/toolSchedule";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { addHold, deleteHold, loadPlan } from "@/lib/toolScheduleStore";

/**
 * Bookings (stored as "holds"): a tool type booked by hand, with no schedule
 * task — for a job (a need before its Gantt exists, a tool kept on site), or
 * for a place that is not a job (the Shop, out for repair, loaned out).
 *
 *   GET                                   → { holds, kinds, jobs }
 *   POST { kindId, jobId | place, startDate, endDate, qty?, note? } → { id }
 *   DELETE ?id=                           → { ok }
 *
 * Gated by the "tool-schedule-edit" view (office + admin).
 */
export const dynamic = "force-dynamic";

const fail = (e: unknown, status = 500) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const [plan, jobs] = await Promise.all([loadPlan(), getJobs(getPaveConfig())]);
    return NextResponse.json({
      holds: plan.holds,
      kinds: plan.kinds.map((k) => ({ id: k.id, name: k.name })),
      jobs: jobs.map((j) => ({ id: j.id, name: j.name })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return fail(e, 502);
  }
}

export async function POST(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can book tools." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const kindId = String(b?.kindId ?? "");
  const jobId = String(b?.jobId ?? "");
  const place = String(b?.place ?? "").trim().slice(0, 100);
  if (!kindId || (!jobId && !place)) return NextResponse.json({ error: "Choose a tool type, and a job or a place." }, { status: 400 });
  if (!isIsoDay(b?.startDate) || !isIsoDay(b?.endDate) || b.endDate < b.startDate) {
    return NextResponse.json({ error: "Give a start date and an end date on or after it." }, { status: 400 });
  }
  try {
    const plan = await loadPlan();
    if (!plan.kinds.some((k) => k.id === kindId)) return NextResponse.json({ error: "No such tool type." }, { status: 404 });
    const id = await addHold(
      {
        kindId,
        jobId,
        jobName: jobId ? String(b?.jobName ?? "").slice(0, 200) : place,
        startDate: b.startDate,
        endDate: b.endDate,
        qty: Math.min(20, Math.max(1, Number(b?.qty) || 1)),
        note: String(b?.note ?? "").slice(0, 300),
      },
      u.email,
    );
    return NextResponse.json({ id });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can remove bookings." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });
  try {
    await deleteHold(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
