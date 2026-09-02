import { NextRequest, NextResponse, after } from "next/server";

import { auth } from "@/auth";
import {
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  getTimeEntryOwner,
  orgLocalToJtIso,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { callAppsScript } from "@/lib/appsScript";
import { readOpenClock } from "@/lib/employeeClock";
import { resolveJtUserLink } from "@/lib/jtUserLink";

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
 * but only as the offline fallback and to carry the one thing JobTread doesn't
 * hold (the log's idempotency key); on any disagreement JobTread wins. The POST ops themselves stay stateless per request.
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
 * ## CLOCKING OUT IS DETACHED, CLOCKING IN IS NOT
 *
 * "out" validates, answers `{ accepted: true }` at once, and finishes in
 * `after()` — the photos to Drive, the Time Entries row, then the JobTread
 * update. It is the slowest thing this page does and it happens at the end of a
 * day in a truck, where holding a request open for all of it meant a locked
 * screen or one dead bar killed the write mid-flight. The phone therefore hears
 * "accepted", not "pushed"; the outcome lands in the Time Entries row's
 * `jtStatus` and in this function's log, and a JobTread refusal is
 * self-correcting because the entry stays OPEN and the GET above offers the
 * Clock Out button back.
 *
 * "in" stays synchronous ON PURPOSE: its whole point is to hand back the new
 * JobTread entry id, which is what the later clock-out updates. It is one API
 * call with no upload behind it, so there is nothing slow to detach.
 *
 * GET  → { ok, openEntry: {entryId, startedAt, jobId, jobLabel, costItemId,
 *          costCode, costItemName, payType, employee} | null, openCount }
 *        startedAt is the org-LOCAL wall clock ("YYYY-MM-DDTHH:MM:SS"), the same
 *        shape the client sends at clock-in.
 * POST { op:"in",  userId, jobId, costItemId, payType, startTime }
 *      → { ok, previewed, entryId, jtStatus, jtError? }
 * POST { op:"out", entryId, userId, jobId, jobLabel?, costItemId, costCode?,
 *        payType?, employee?, startTime, startEdited?, endTime, note,
 *        photos:[{base64, mimeType, name}] }
 *      → { ok, accepted, previewed, jtEntryId, photoCount }
 *        `startEdited` means the crew member CORRECTED the clock-in time in the
 *        Clock out sheet; only then does the JobTread update write startedAt.
 *        The Time Entries log row always records the startTime as sent.
 * POST { op:"cancel", entryId } → { ok }
 * POST { op:"edit", entryId, jobId, costItemId, startTime, endTime, note }
 *      → { ok, previewed, wrote, jtStatus, minutes? }
 *        Edits an existing (closed) entry from the Timesheets tab — re-times it
 *        (JobTread recomputes minutes/cost from the new span), moves the job/cost
 *        code, and revises the note. Gated by COMPANION_WRITES_ENABLED like every
 *        other write here, and only ever on the caller's OWN entry: the owning
 *        user is re-read from JobTread and compared to the session identity, so a
 *        client-supplied entryId can't touch someone else's time. The pay type is
 *        NOT edited (its update shape is unverified, and changing it re-rates the
 *        entry) — it rides along for display only.
 */
export const dynamic = "force-dynamic";
// Room for the DETACHED clock-out work (Drive upload + Sheet append + JobTread
// update), which keeps this function alive after the response has gone out.
export const maxDuration = 300;

// "YYYY-MM-DDTHH:MM" (or with :SS) → a normalised local wall clock for the Time
// Entries log; the JobTread write converts it with orgLocalToJtIso. Mirrors
// ../route.ts's toLocalStamp.
function toLocalStamp(v: string): string {
  const t = (v ?? "").trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}`;
}

// The signed-in email → JobTread identity comes from the shared, DB-backed
// cache (lib/jtUserLink). It used to be a per-instance Map, which meant every
// cold lambda paid the ~3 s Apps Script round trip again. Always keyed by the
// AUTHENTICATED session email, never a client-supplied id.

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

  const link = await resolveJtUserLink(email);
  const userId = link?.jtUserId ?? "";
  const name = (link?.name || link?.jtUserName || "").trim();
  // Not linked to a JobTread user — there's no clock to look up. Not an error
  // here: the bootstrap route already tells them how to link, and the page must
  // still fall back to whatever it has locally.
  if (!userId) return NextResponse.json({ ok: true, openEntry: null, openCount: 0, linked: false });

  try {
    const { openEntry, openCount } = await readOpenClock(userId, name);
    return NextResponse.json({ ok: true, linked: true, openCount, openEntry });
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
  startEdited?: boolean;
  endTime?: string;
  note?: string;
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
    // The crew member corrected the clock-in time on the way out ("started at
    // 7, clocked in at 9"). Only then does the JobTread update carry startedAt.
    const startEdited = body.startEdited === true;
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

    const pushable = !!entryId && writesEnabled();
    const pendingStatus = !writesEnabled()
      ? "not pushed (writes off)"
      : entryId
        ? "pending push"
        : "not pushed (no JobTread clock-in id)"; // clock-in never got an id
    const photos = (body.photos ?? []).filter((p) => p && p.base64);

    // DETACHED — see the note at the top of this file. Clocking out is the
    // slowest thing this page does (photos to Drive, a Sheet append, then the
    // JobTread update) and it happens where service is worst, so the phone is
    // answered now and the work finishes on the server.
    after(async () => {
      // Reserve the record first, keyed by clientKey — a retry returns this row
      // instead of appending a second one, and we skip the JobTread update below.
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
        jtEntryId: pushable ? "" : entryId, // no-push rows still record the clock-in id if any
        jtStatus: pendingStatus,
        loggedBy: email,
        photos,
      });
      if (reserved.error) {
        console.error(`[clock-out] ${clientKey}: could not file the record:`, reserved.error);
        return;
      }
      const l = (reserved.data ?? {}) as {
        ok?: boolean;
        error?: string;
        duplicate?: boolean;
      };
      if (l?.ok === false) {
        console.error(`[clock-out] ${clientKey}: the record was refused:`, l.error ?? "");
        return;
      }
      // Already handled under this key — the outcome is on the row; never
      // update JobTread twice.
      if (l.duplicate) return;

      // First time for this key: set endedAt on the open JobTread entry, then
      // record the outcome back onto the reserved row.
      if (!pushable) return;
      let jtStatus = "pending push";
      try {
        // startedAt only rides along when the crew member CORRECTED it on the
        // way out. Left alone, the entry keeps the instant its clock-in wrote.
        await updateTimeEntry(getPaveConfig(), entryId, {
          endedAt,
          notes: note,
          ...(startEdited ? { startedAt } : {}),
        });
        jtStatus = "pushed";
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        jtStatus = "JobTread error: " + message;
        // A clock-out JobTread refuses leaves the entry OPEN in JobTread, which
        // is self-correcting: the GET above finds it again and the page offers
        // the Clock Out button back.
        console.error(`[clock-out] ${clientKey}: JobTread refused the clock-out:`, message);
      }
      await callAppsScript({ action: "finalizeTimeEntryLog", clientKey, jtEntryId: entryId, jtStatus });
    });

    return NextResponse.json({
      ok: true,
      accepted: true,
      previewed: !writesEnabled(),
      jtEntryId: entryId,
      photoCount: photos.length,
    });
  }

  // -------------------------------------------------------------- edit ------
  // Revise an existing (closed) entry from the Timesheets tab. Same field set as
  // "Log a range", but it UPDATES the entry in place rather than creating a new
  // one — so the hourly JobTread→Sheet mirror carries the change without a
  // competing companion write. No Time Entries log row is appended (that log is
  // for clock-outs / one-shot logs, not edits of time JobTread already holds).
  if (op === "edit") {
    const link = await resolveJtUserLink(email);
    const userId = link?.jtUserId ?? "";
    if (!userId) {
      return NextResponse.json({
        ok: false,
        error:
          "No linked JobTread user for your login — an admin can link you on the Employees page.",
      });
    }

    const entryId = (body.entryId ?? "").trim();
    const jobId = (body.jobId ?? "").trim();
    const costItemId = (body.costItemId ?? "").trim();
    const note = (body.note ?? "").trim();
    const startLocal = toLocalStamp(body.startTime ?? "");
    const endLocal = toLocalStamp(body.endTime ?? "");
    const startedAt = orgLocalToJtIso(startLocal);
    const endedAt = orgLocalToJtIso(endLocal);

    if (!entryId) return NextResponse.json({ ok: false, error: "Missing the time entry to edit." }, { status: 400 });
    if (!jobId) return NextResponse.json({ ok: false, error: "Pick a job." }, { status: 400 });
    if (!costItemId) return NextResponse.json({ ok: false, error: "Pick a cost code." }, { status: 400 });
    if (!note) return NextResponse.json({ ok: false, error: "A note is required." }, { status: 400 });
    if (!startedAt || !endedAt) {
      return NextResponse.json({ ok: false, error: "Missing start/stop time." }, { status: 400 });
    }
    if (endedAt <= startedAt) {
      return NextResponse.json({ ok: false, error: "Stop time must be after the start time." }, { status: 400 });
    }

    if (!writesEnabled()) {
      return NextResponse.json({
        ok: true,
        previewed: true,
        wrote: false,
        jtStatus: "not pushed (writes off)",
      });
    }

    // Only your own time. The entry id is client-supplied, so re-read the owner
    // from JobTread and compare it to the resolved session identity.
    let owner: string | null;
    try {
      owner = await getTimeEntryOwner(getPaveConfig(), entryId);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Could not check that entry." },
        { status: 502 },
      );
    }
    if (!owner) {
      return NextResponse.json({ ok: false, error: "That time entry no longer exists." }, { status: 404 });
    }
    if (owner !== userId) {
      return NextResponse.json({ ok: false, error: "You can only edit your own time." }, { status: 403 });
    }

    // jobId + costItemId are sent together: JobTread rejects a job move without
    // a cost item (cost items are per-job). Re-timing recomputes minutes/cost.
    try {
      const res = await updateTimeEntry(getPaveConfig(), entryId, {
        jobId,
        costItemId,
        startedAt,
        endedAt,
        notes: note,
      });
      return NextResponse.json({
        ok: true,
        previewed: false,
        wrote: true,
        jtStatus: "pushed",
        minutes: res.minutes,
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Could not save your changes." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: false, error: `Unknown op: ${op}` }, { status: 400 });
}
