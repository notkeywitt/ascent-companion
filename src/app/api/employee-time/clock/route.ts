import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  orgLocalToJtIso,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Clock in/out — the sibling of ../route.ts's one-shot "log a time range" form.
 * Clock-in creates an OPEN JobTread time entry (startedAt only); clock-out sets
 * its endedAt (+ the required note) via updateTimeEntry; cancel deletes a
 * mistaken clock-in. There is no server-side "active clock" state — the client
 * holds the entry id + job/cost/pay-type context in localStorage between the two
 * calls (mirrors /mileage-tracker's start/end trip pattern), so this route is
 * stateless per request.
 *
 * Gated by COMPANION_WRITES_ENABLED like the rest of this page: with writes off,
 * "in" skips createTimeEntry and returns an empty entryId (previewed:true) so the
 * whole flow can still be exercised — clock-out then just logs the Time Entries
 * row with no JobTread call to update. A CANCEL never logs anything (a cancelled
 * clock-in never happened, same as Mileage's "Cancel trip").
 *
 * POST { op:"in",  userId, jobId, costItemId, payType, startTime }
 *      → { ok, previewed, entryId, jtStatus, jtError? }
 * POST { op:"out", entryId, userId, jobId, jobLabel?, costItemId, costCode?,
 *        payType?, employee?, startTime, endTime, note,
 *        lat?, lng?, nearestJob?, photos:[{base64, mimeType, name}] }
 *      → { ok, previewed, wrote, jtEntryId, jtStatus, jtError?, entryId,
 *          photoCount, date }
 * POST { op:"cancel", entryId } → { ok }
 */
export const dynamic = "force-dynamic";

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as unknown, status: 200 };
    } catch {
      return {
        error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        status: 502,
      };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error", status: 502 };
  }
}

// "YYYY-MM-DDTHH:MM" (or with :SS) → a normalised local wall clock for the Time
// Entries log; the JobTread write converts it with orgLocalToJtIso. Mirrors
// ../route.ts's toLocalStamp.
function toLocalStamp(v: string): string {
  const t = (v ?? "").trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}`;
}

interface Photo {
  base64?: string;
  mimeType?: string;
  name?: string;
}
interface Body {
  op?: string;
  clientKey?: string;
  entryId?: string;
  userId?: string;
  employee?: string;
  jobId?: string;
  jobLabel?: string;
  costItemId?: string;
  costCode?: string;
  payType?: string;
  startTime?: string;
  endTime?: string;
  note?: string;
  lat?: number;
  lng?: number;
  nearestJob?: string;
  photos?: Photo[];
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const session = await auth();
  const email = session?.user?.email ?? "";
  const op = (body.op ?? "").trim();

  // -------------------------------------------------------------- clock IN --
  if (op === "in") {
    const userId = (body.userId ?? "").trim();
    const jobId = (body.jobId ?? "").trim();
    const costItemId = (body.costItemId ?? "").trim();
    const payType = (body.payType ?? "").trim();
    const startedAt = orgLocalToJtIso(toLocalStamp(body.startTime ?? ""));

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "No JobTread user — pick who you are in JobTread first." },
        { status: 400 },
      );
    }
    if (!jobId) return NextResponse.json({ ok: false, error: "Pick a job." }, { status: 400 });
    if (!costItemId) return NextResponse.json({ ok: false, error: "Pick a cost code." }, { status: 400 });
    if (!startedAt) return NextResponse.json({ ok: false, error: "Missing clock-in time." }, { status: 400 });

    if (!writesEnabled()) {
      return NextResponse.json({
        ok: true,
        previewed: true,
        entryId: "",
        jtStatus: "not pushed (writes off)",
      });
    }
    if (!payType) return NextResponse.json({ ok: false, error: "Pick a pay type." }, { status: 400 });

    try {
      const { id } = await createTimeEntry(getPaveConfig(), {
        userId,
        jobId,
        costItemId,
        startedAt,
        type: payType,
        notes: "",
        isApproved: false,
      });
      return NextResponse.json({ ok: true, previewed: false, entryId: id, jtStatus: "pushed" });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Could not clock in." },
        { status: 502 },
      );
    }
  }

  // ----------------------------------------------------------- clock CANCEL --
  if (op === "cancel") {
    const entryId = (body.entryId ?? "").trim();
    if (entryId && writesEnabled()) {
      try {
        await deleteTimeEntry(getPaveConfig(), entryId);
      } catch (e) {
        // The client clears its local state either way — an undeleted entry is
        // an orphan the office can clean up in JobTread, not a blocking error.
        return NextResponse.json({
          ok: true,
          warning: `Clock-in cancelled here, but JobTread couldn't delete it: ${
            e instanceof Error ? e.message : "Unknown error"
          }`,
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ------------------------------------------------------------- clock OUT --
  if (op === "out") {
    const entryId = (body.entryId ?? "").trim();
    const note = (body.note ?? "").trim();
    const startLocal = toLocalStamp(body.startTime ?? "");
    const endLocal = toLocalStamp(body.endTime ?? "");
    const startedAt = orgLocalToJtIso(startLocal);
    const endedAt = orgLocalToJtIso(endLocal);
    // Idempotency key for the clock-out log — the phone generates it at clock-in
    // and resends it on every clock-out retry (bad service drops the response,
    // not the work). Falls back to a per-request id for older clients.
    const clientKey = (body.clientKey ?? "").trim() || `te-${crypto.randomUUID()}`;

    if (!note) return NextResponse.json({ ok: false, error: "A note is required." }, { status: 400 });
    if (!startedAt || !endedAt) {
      return NextResponse.json({ ok: false, error: "Missing clock-in/out time." }, { status: 400 });
    }
    if (endedAt <= startedAt) {
      return NextResponse.json({ ok: false, error: "Stop time must be after the start time." }, { status: 400 });
    }

    // Reserve the record first, keyed by clientKey — a retry returns this row
    // instead of appending a second one, and we skip the JobTread update below.
    const pushable = !!entryId && writesEnabled();
    const pendingStatus = !writesEnabled()
      ? "not pushed (writes off)"
      : entryId
        ? "pending push"
        : "not pushed (no JobTread clock-in id)"; // clock-in never got an id
    const photos = (body.photos ?? []).filter((p) => p && p.base64);
    const reserved = await callAppsScript({
      action: "logTimeEntry",
      clientKey,
      employee: body.employee ?? "",
      employeeEmail: email,
      jtUserId: (body.userId ?? "").trim(),
      jobLabel: body.jobLabel ?? "",
      jobId: (body.jobId ?? "").trim(),
      costCode: body.costCode ?? "",
      costItemId: (body.costItemId ?? "").trim(),
      payType: body.payType ?? "",
      startTime: startLocal,
      endTime: endLocal,
      note,
      lat: body.lat ?? "",
      lng: body.lng ?? "",
      nearestJob: body.nearestJob ?? "",
      jtEntryId: pushable ? "" : entryId, // no-push rows still record the clock-in id if any
      jtStatus: pendingStatus,
      loggedBy: email,
      photos,
    });
    if (reserved.error) {
      return NextResponse.json({ ok: false, error: reserved.error }, { status: reserved.status });
    }
    const l = (reserved.data ?? {}) as {
      ok?: boolean;
      error?: string;
      duplicate?: boolean;
      entryId?: string;
      date?: string;
      photoCount?: number;
      jtEntryId?: string;
      jtStatus?: string;
    };
    if (l?.ok === false) {
      return NextResponse.json(l, { status: 200 });
    }
    if (l.duplicate) {
      const priorStatus = l.jtStatus ?? "";
      return NextResponse.json({
        ok: true,
        duplicate: true,
        previewed: /writes off/i.test(priorStatus),
        wrote: priorStatus === "pushed",
        jtEntryId: l.jtEntryId ?? entryId,
        jtStatus: priorStatus,
        entryId: l.entryId ?? "",
        date: l.date ?? "",
        photoCount: l.photoCount ?? 0,
      });
    }

    // First time for this key: set endedAt on the open JobTread entry, then
    // record the outcome back onto the reserved row.
    let jtStatus = pendingStatus;
    let jtError = "";
    if (pushable) {
      try {
        await updateTimeEntry(getPaveConfig(), entryId, { endedAt, notes: note });
        jtStatus = "pushed";
      } catch (e) {
        jtError = e instanceof Error ? e.message : "Unknown error";
        jtStatus = "JobTread error: " + jtError;
      }
      await callAppsScript({ action: "finalizeTimeEntryLog", clientKey, jtEntryId: entryId, jtStatus });
    }

    return NextResponse.json({
      ok: true,
      previewed: !writesEnabled(),
      wrote: !!entryId && jtStatus === "pushed",
      jtEntryId: entryId,
      jtStatus,
      jtError: jtError || undefined,
      entryId: l.entryId ?? "",
      date: l.date ?? "",
      photoCount: l.photoCount ?? 0,
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown op: ${op}` }, { status: 400 });
}
