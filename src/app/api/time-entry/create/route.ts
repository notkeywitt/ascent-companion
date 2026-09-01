import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearJobCostCaches,
  createTimeEntry,
  getJobBudget,
  getOrgTimeEntryTypeNames,
  getOrgUsers,
  orgLocalToJtIso,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * A NEW time entry, logged for somebody else — the write behind Tracking
 * Sheets' "Add time" dialog.
 *
 * The office half of /api/employee-time's POST. That route is the crew's own
 * page: it attributes the entry to the signed-in person, reserves an auditable
 * "Time Entries" sheet row (with photos) before it touches JobTread, and rides
 * the Field gate. This one is the office fixing the month's labor while it
 * codes the month's bills — one employee at a time, no photos, no sheet row —
 * and it sits under /api/time-entry so it rides the SAME Tracking Sheets gate
 * as the panel that edits an entry (see views.ts). The two never share a body
 * shape, so they stay apart rather than growing a mode flag.
 *
 * WALL CLOCKS IN, INSTANTS OUT — same rule as the sibling POST: the dialog
 * sends the org's local wall clock and orgLocalToJtIso() converts here. A bare
 * wall clock lands the entry 7 hours early.
 *
 * A PAY TYPE IS REQUIRED. JobTread 400s a createTimeEntry without one (the cost
 * is minutes × that type's rate), so the dialog picks it and this refuses the
 * write without it.
 *
 * GET  → { ok, users, orgTypes }   employees + their pay types for the picker
 * POST { userId, jobId, costItemId, payType, date, startTime, endTime, notes? }
 *      → { ok, previewed, wrote, jtEntryId }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const cfg = getPaveConfig();
  const [users, orgTypes] = await Promise.all([
    getOrgUsers(cfg).catch(() => []),
    // Fallback list, for when the grant can't read each member's own pay types
    // (per-member types 403 → getOrgUsers leaves them undefined).
    getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
  ]);
  return NextResponse.json({ ok: true, users, orgTypes });
}

interface CreateBody {
  userId?: string;
  jobId?: string;
  costItemId?: string;
  payType?: string;
  /** Org-local "YYYY-MM-DD". */
  date?: string;
  /** Org-local "HH:MM". */
  startTime?: string;
  /** Org-local "HH:MM"; may be on the NEXT day, which is inferred from the start. */
  endTime?: string;
  notes?: string;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = body.userId?.trim() ?? "";
  const jobId = body.jobId?.trim() ?? "";
  const costItemId = body.costItemId?.trim() ?? "";
  const payType = body.payType?.trim() ?? "";
  const date = body.date?.trim() ?? "";
  const startTime = body.startTime?.trim() ?? "";
  const endTime = body.endTime?.trim() ?? "";
  const notes = body.notes?.trim() ?? "";

  if (!userId) return NextResponse.json({ error: "Pick an employee." }, { status: 400 });
  if (!jobId) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  if (!costItemId) return NextResponse.json({ error: "Pick a cost code." }, { status: 400 });
  if (!date || !startTime || !endTime) {
    return NextResponse.json({ error: "Enter a date, a start and a stop time." }, { status: 400 });
  }
  if (!payType) return NextResponse.json({ error: "Pick a pay type." }, { status: 400 });

  const startedAt = orgLocalToJtIso(`${date}T${startTime}:00`);
  if (!startedAt) {
    return NextResponse.json({ error: `Unreadable start: ${date} ${startTime}` }, { status: 400 });
  }
  // An overnight shift ends at a clock time EARLIER than it started, on the next
  // day — the same reading the edit panel takes rather than rejecting it.
  const sameDay = orgLocalToJtIso(`${date}T${endTime}:00`);
  if (!sameDay) {
    return NextResponse.json({ error: `Unreadable end: ${date} ${endTime}` }, { status: 400 });
  }
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const endedAt =
    Date.parse(sameDay) > Date.parse(startedAt)
      ? sameDay
      : orgLocalToJtIso(`${next.toISOString().slice(0, 10)}T${endTime}:00`);

  // Cost items are per-job. A leaf from another job is either rejected by
  // JobTread or strands the entry, so check the pair here — same guard the job
  // move in the sibling POST uses.
  const leaves = await getJobBudget(getPaveConfig(), jobId);
  if (!leaves.some((b) => b.id === costItemId)) {
    return NextResponse.json(
      { error: "That cost code doesn't belong to the job you picked." },
      { status: 400 },
    );
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      entry: { userId, jobId, costItemId, payType, startedAt, endedAt, notes },
    });
  }

  // Attribution comes from the session, never the body — same rule as the
  // sibling POST and /api/code.
  await auth();

  try {
    const { id } = await createTimeEntry(getPaveConfig(), {
      userId,
      jobId,
      costItemId,
      type: payType,
      startedAt,
      endedAt,
      notes,
      isApproved: false,
    });
    // New hours and dollars against a cost code — every cached per-code total
    // on this board and Labor Review's is stale.
    clearJobCostCaches();
    return NextResponse.json({ previewed: false, wrote: true, jtEntryId: id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
