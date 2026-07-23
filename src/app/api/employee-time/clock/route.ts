import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { createTimeEntry, updateTimeEntry, deleteTimeEntry } from "@/lib/jobtread";
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

// "YYYY-MM-DDTHH:MM" (or with :SS) local wall-clock → the floating ISO JobTread
// stores (no Z/offset). Mirrors ../route.ts's toFloatingIso.
function toFloatingIso(v: string): string {
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
    const startedAt = toFloatingIso(body.startTime ?? "");

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
    const startedAt = toFloatingIso(body.startTime ?? "");
    const endedAt = toFloatingIso(body.endTime ?? "");

    if (!note) return NextResponse.json({ ok: false, error: "A note is required." }, { status: 400 });
    if (!startedAt || !endedAt) {
      return NextResponse.json({ ok: false, error: "Missing clock-in/out time." }, { status: 400 });
    }
    if (endedAt <= startedAt) {
      return NextResponse.json({ ok: false, error: "Stop time must be after the start time." }, { status: 400 });
    }

    let jtStatus = "";
    let jtError = "";
    if (entryId && writesEnabled()) {
      try {
        await updateTimeEntry(getPaveConfig(), entryId, { endedAt, notes: note });
        jtStatus = "pushed";
      } catch (e) {
        jtError = e instanceof Error ? e.message : "Unknown error";
        jtStatus = "JobTread error: " + jtError;
      }
    } else {
      jtStatus = "not pushed (writes off)";
    }

    const photos = (body.photos ?? []).filter((p) => p && p.base64);
    const logged = await callAppsScript({
      action: "logTimeEntry",
      employee: body.employee ?? "",
      employeeEmail: email,
      jtUserId: (body.userId ?? "").trim(),
      jobLabel: body.jobLabel ?? "",
      jobId: (body.jobId ?? "").trim(),
      costCode: body.costCode ?? "",
      costItemId: (body.costItemId ?? "").trim(),
      payType: body.payType ?? "",
      startTime: startedAt,
      endTime: endedAt,
      note,
      lat: body.lat ?? "",
      lng: body.lng ?? "",
      nearestJob: body.nearestJob ?? "",
      jtEntryId: entryId,
      jtStatus,
      loggedBy: email,
      photos,
    });
    if (logged.error) {
      return NextResponse.json(
        { ok: false, error: logged.error, jtEntryId: entryId, jtStatus, jtError },
        { status: logged.status },
      );
    }
    const l = (logged.data ?? {}) as {
      ok?: boolean;
      error?: string;
      entryId?: string;
      date?: string;
      photoCount?: number;
    };
    if (l?.ok === false) {
      return NextResponse.json({ ...l, jtEntryId: entryId, jtStatus, jtError }, { status: 200 });
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
