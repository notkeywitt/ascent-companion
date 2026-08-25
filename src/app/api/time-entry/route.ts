import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearJobCostCaches,
  getJobBudget,
  orgLocalToJtIso,
  updateTimeEntry,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * ONE time entry, edited in place — the write behind Client Invoicing's
 * "Time & labor" panel.
 *
 * Labor Review's POST (/api/labor-review) recodes a BATCH of entries and edits
 * nothing else: it is the staged-then-synced twin of the bill board, so it only
 * ever sends `costItemId`. This route is the other shape — the office has one
 * entry open and is fixing what's wrong with it (wrong code, wrong day, wrong
 * hours, wrong job), so it writes that entry immediately and completely, the
 * same way the coding card's structural edits (combine, buyback, delete) write
 * rather than stage. Keeping them apart is deliberate: neither route has to
 * grow a mode flag, and Labor Review's staged math stays untouched.
 *
 * GET  ?jobId=…            → that job's budget leaves, so the panel can offer
 *                            legal cost codes for a job it is MOVING an entry
 *                            to (cost items are per-job — the board's own
 *                            budget is no use for another job).
 * POST { id, … }           → apply the edit.
 *
 * WALL CLOCKS IN, INSTANTS OUT. The panel sends `date` + `startTime` + `endTime`
 * as the org's local wall clock, because that is what the crew and the office
 * both read off JobTread's screen. orgLocalToJtIso() converts at this boundary —
 * sending a bare wall clock to the API lands the entry 7 hours early (see the
 * timestamp note in lib/jobtread.ts).
 *
 * ALL THREE WRITES ARE PROBE-CONFIRMED (2026-08-25, see the note on
 * updateTimeEntry in lib/jobtread.ts): a recode leaves the money alone, a
 * re-time makes JobTread recompute minutes and therefore cost, and a job move
 * is only legal WITH a cost item on the target job — `jobId` alone comes back
 * 400 "A job & cost item are required for this time entry". The guard below
 * refuses that pairing before the write rather than relaying JobTread's wording.
 */

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass jobId" }, { status: 400 });
  try {
    const budget = await getJobBudget(getPaveConfig(), jobId);
    return NextResponse.json({ jobId, budget });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

interface EditBody {
  id?: string;
  /** The budget leaf to code the entry to. Required when `jobId` moves. */
  costItemId?: string;
  /** Move the entry to another job. Cost items are per-job, so it never travels alone. */
  jobId?: string;
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
  let body: EditBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id) return NextResponse.json({ error: "Pass the time entry id" }, { status: 400 });

  const fields: {
    startedAt?: string;
    endedAt?: string;
    costItemId?: string;
    jobId?: string;
    notes?: string;
  } = {};

  // ---- the timestamps ----
  // A date change alone still rewrites BOTH ends: the entry keeps the hours it
  // has, moved to the new day. So the panel always sends the whole triple and
  // this only has to convert it.
  const date = body.date?.trim();
  const startTime = body.startTime?.trim();
  const endTime = body.endTime?.trim();
  if (date || startTime || endTime) {
    if (!date || !startTime) {
      return NextResponse.json(
        { error: "A time change needs both a date and a start time." },
        { status: 400 },
      );
    }
    const startedAt = orgLocalToJtIso(`${date}T${startTime}:00`);
    if (!startedAt) {
      return NextResponse.json({ error: `Unreadable start: ${date} ${startTime}` }, { status: 400 });
    }
    fields.startedAt = startedAt;
    if (endTime) {
      // An overnight shift ends at a clock time EARLIER than it started, on the
      // next day. Rolling the date forward is the only reading that isn't a
      // negative shift, so take it rather than rejecting the edit.
      const sameDay = orgLocalToJtIso(`${date}T${endTime}:00`);
      if (!sameDay) {
        return NextResponse.json({ error: `Unreadable end: ${date} ${endTime}` }, { status: 400 });
      }
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      fields.endedAt =
        Date.parse(sameDay) > Date.parse(startedAt)
          ? sameDay
          : orgLocalToJtIso(`${next.toISOString().slice(0, 10)}T${endTime}:00`);
    }
  }

  // ---- coding + job ----
  const jobId = body.jobId?.trim();
  const costItemId = body.costItemId?.trim();
  if (jobId && !costItemId) {
    return NextResponse.json(
      { error: "Moving an entry to another job needs a cost code on that job." },
      { status: 400 },
    );
  }
  if (jobId) {
    // Cost items are per-job, so a leaf from the OLD job would either be
    // rejected or strand the entry. Check the pair before writing rather than
    // finding out from JobTread's error text.
    const leaves = await getJobBudget(getPaveConfig(), jobId);
    if (!leaves.some((b) => b.id === costItemId)) {
      return NextResponse.json(
        { error: "That cost code doesn't belong to the job you're moving the entry to." },
        { status: 400 },
      );
    }
    fields.jobId = jobId;
  }
  if (costItemId) fields.costItemId = costItemId;
  if (typeof body.notes === "string") fields.notes = body.notes;

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      fields,
    });
  }

  // Attribution comes from the session, never the body — same rule as /api/code.
  await auth();

  try {
    const res = await updateTimeEntry(getPaveConfig(), id, fields);
    // Hours and dollars moved between cost codes — and possibly between jobs —
    // so every cached per-code total is stale, on this board and Labor Review's.
    clearJobCostCaches();
    return NextResponse.json({ previewed: false, wrote: true, entry: res });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
