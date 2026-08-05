import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  getOpenTimeEntries,
  orgLocalToJtIso,
  jtIsoToOrgLocal,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Clock in/out — the sibling of ../route.ts's one-shot "log a time range" form.
 * Clock-in creates an OPEN JobTread time entry (startedAt only); clock-out sets
 * its endedAt (+ the required note) via updateTimeEntry; cancel deletes a
 * mistaken clock-in.
 *
 * The RUNNING clock lives in JobTread, not here and not in one phone's storage:
 * an open entry (endedAt null) IS the fact that you're clocked in. GET returns
 * it, so opening the page on any device — a new phone, a cleared browser, the
 * office desktop — shows the live Clock Out button with the real start time and
 * job/cost context. The client still mirrors its own clock-in to localStorage,
 * but only as the offline fallback and to carry the two things JobTread doesn't
 * hold (the clock-in GPS fix and the log's idempotency key); on any disagreement
 * JobTread wins. The POST ops themselves stay stateless per request.
 *
 * Gated by COMPANION_WRITES_ENABLED like the rest of this page: with writes off,
 * "in" skips createTimeEntry and returns an empty entryId (previewed:true) so the
 * whole flow can still be exercised — clock-out then just logs the Time Entries
 * row with no JobTread call to update. Such a preview clock exists ONLY in
 * localStorage, so GET can't see it (openEntry:null) — which is why the client
 * never lets a null answer clear a clock that has no JobTread id. A CANCEL never
 * logs anything (a cancelled clock-in never happened, same as Mileage's "Cancel
 * trip").
 *
 * GET  → { ok, openEntry: {entryId, startedAt, jobId, jobLabel, costItemId,
 *          costCode, costItemName, payType, employee} | null, openCount }
 *        startedAt is the org-LOCAL wall clock ("YYYY-MM-DDTHH:MM:SS"), the same
 *        shape the client sends at clock-in.
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

// How far back a still-open entry is treated as a resumable running clock. Wide
// enough for the real case (forgot to clock out Friday, back Monday), bounded so
// a long-abandoned entry from weeks ago doesn't hijack the page — by then it's a
// correction for the office, and "My Time" still surfaces it via openCount.
const RESUME_WINDOW_DAYS = 7;

// Memoized signed-in email → JobTread user id + name, exactly as ../history does
// (see the longer note there). Keyed by the AUTHENTICATED session email, never a
// client-supplied id, so this is pure memoization and not a trust change; the
// short TTL bounds staleness after an admin re-links the roster. Per warm
// instance.
const _meByEmail = new Map<string, { userId: string; name: string; expires: number }>();
const ME_TTL_MS = 5 * 60_000;

/**
 * GET — the signed-in employee's RUNNING clock straight from JobTread, so the
 * page can resume it on a device that never saw the clock-in.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  const session = await auth();
  const email = session?.user?.email ?? "";

  let userId = "";
  let name = "";
  const cached = email ? _meByEmail.get(email) : undefined;
  if (cached && cached.expires > Date.now()) {
    userId = cached.userId;
    name = cached.name;
  } else {
    const boot = await callAppsScript({ action: "timeEntryBootstrap", email });
    if (boot.error) return NextResponse.json({ ok: false, error: boot.error }, { status: boot.status });
    const b = (boot.data ?? {}) as {
      ok?: boolean;
      error?: string;
      me?: { jtUserId?: string; name?: string; jtUserName?: string };
    };
    if (b?.ok === false) return NextResponse.json(b, { status: 200 });
    userId = (b.me?.jtUserId ?? "").trim();
    name = (b.me?.name || b.me?.jtUserName || "").trim();
    if (email && userId) _meByEmail.set(email, { userId, name, expires: Date.now() + ME_TTL_MS });
  }
  // Not linked to a JobTread user — there's no clock to look up. Not an error
  // here: the bootstrap route already tells them how to link, and the page must
  // still fall back to whatever it has locally.
  if (!userId) return NextResponse.json({ ok: true, openEntry: null, openCount: 0, linked: false });

  try {
    const since = new Date(Date.now() - RESUME_WINDOW_DAYS * 86_400_000).toISOString();
    const open = await getOpenTimeEntries(getPaveConfig(), userId, { sinceIso: since });
    const e = open[0]; // newest-first
    return NextResponse.json({
      ok: true,
      linked: true,
      openCount: open.length,
      openEntry: e
        ? {
            entryId: e.id,
            // JobTread stores a real UTC instant; the client works in org-local
            // wall clock (that's what it sends at clock-in and what the elapsed
            // timer and the Time Entries log expect).
            startedAt: jtIsoToOrgLocal(e.startedAt),
            jobId: e.jobId,
            jobLabel: e.jobLabel,
            costItemId: e.costItemId,
            costCode: e.costCode,
            costItemName: e.costItemName,
            payType: e.payType,
            employee: name,
          }
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not check your clock." },
      { status: 502 },
    );
  }
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
