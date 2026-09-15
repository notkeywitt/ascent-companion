import { NextRequest, NextResponse, after } from "next/server";

import { auth } from "@/auth";
import {
  getOrgUsers,
  getOrgTimeEntryTypeNames,
  getTimeTrackableLeaves,
  createTimeEntry,
  orgLocalToJtIso,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { callAppsScript } from "@/lib/appsScript";
import { openJournal } from "@/lib/financialJournal";
import { resolveJtUserLink } from "@/lib/jtUserLink";
import { resolveTimeIdentity } from "@/lib/actingAs";

/**
 * Backend for the Assistant's /employee-time page — logging a specific time
 * range in one shot (job + cost code + start/stop + a required note + optional
 * photos). The clock-in/out flow is the sibling route ./clock/route.ts; the
 * bi-monthly "my time" list is ./history/route.ts.
 *
 * This route straddles both systems. JobTread reads/writes go direct through the
 * grant-holding lib (@/lib/jobtread): the org users + their pay types, a job's
 * cost items, and the createTimeEntry write. Everything only Apps Script can do —
 * resolving the signed-in email to its linked JobTread user id, storing the
 * photos in Drive, and appending the auditable "Time Entries" row — goes over
 * the shared-secret web app.
 *
 * No location is captured or returned: the nearest-job GPS pre-fill (and the
 * job-site coordinate list that fed it) was removed 2026-08-26.
 *
 * The JobTread write is gated by COMPANION_WRITES_ENABLED (default OFF → preview,
 * like /api/add-line and /api/add-bill). createTimeEntry/updateTimeEntry/
 * deleteTimeEntry are all confirmed live (2026-07-23, probeTimeEntryClockInOut()
 * in ascent-appscript EmployeeTime.js created, updated, and deleted a real
 * [PROBE] entry) — but the app itself has never sent a real employee entry, so
 * the first live use from this page should still be verified. The Time Entries
 * log + photos are saved EITHER way, so the office's record is never lost even
 * when the push is off or JobTread errors.
 *
 * Env (secret shared with /api/mileage, /api/tool-tracker, /api/employees):
 *   APPS_SCRIPT_SYNC_URL, APPS_SCRIPT_SYNC_SECRET, JT_GRANT_KEY, JT_ORG_ID,
 *   COMPANION_WRITES_ENABLED
 *
 * ## THE WRITE IS DETACHED
 *
 * POST validates, answers `{ accepted: true }` at once, and does the work in
 * `after()` — which keeps the function alive for its own maxDuration no matter
 * what the client does next. This is a phone in a truck: a clock-out with three
 * job photos is a Drive upload plus a Sheet append plus a JobTread write, and
 * holding that request open meant a locked screen or a dropped bar killed it
 * mid-flight, with the employee left staring at an error over work that may or
 * may not have been saved. The record now always finishes on the server.
 *
 * WHAT THE PHONE GIVES UP is the per-entry outcome: it is told the entry was
 * accepted, not whether JobTread took it. The outcome still lands in two
 * durable places — the Time Entries row's `jtStatus`, and this function's log —
 * and the employee can see the entry itself on the Timesheets tab, which reads
 * JobTread. Losing an entry was the real failure; not confirming the push in
 * the same second is not.
 *
 * The `clientKey` dedupe survives the change and still matters: it is what
 * makes a double-tap or a replay reconcile to one row instead of two.
 *
 *   GET                → { ok, me, jtUsers, orgTypes }           (page bootstrap)
 *   GET ?jobId=<id>    → { ok, laborOnly, costItems:[{id, number, name, detail,
 *                        costType}] }  (the lines time may be coded to)
 *   POST { userId, jobId, jobLabel?, costItemId, costCode?, payType?, startTime,
 *          endTime, note, employee?, photos:[{base64, mimeType, name}] }
 *        → { ok, accepted, previewed, photoCount }
 */
export const dynamic = "force-dynamic";
// Room for the detached work, not for the answer: the response goes out in
// milliseconds, but the Drive upload + Sheet append + JobTread write behind it
// keep this function alive and must not be cut off half-written.
export const maxDuration = 300;

// datetime-local ("YYYY-MM-DDTHH:MM") → a normalised local wall clock with
// seconds. This is what the Time Entries sheet logs (the office reads it as
// plain local time); the JobTread write converts it to a real UTC instant with
// orgLocalToJtIso — JT reads a zoneless stamp as UTC, so sending the wall clock
// raw landed every entry 7 hours early. "" if unparseable.
function toLocalStamp(v: string): string {
  const t = (v ?? "").trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}`;
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const cfg = getPaveConfig();

  // ?jobId → just that job's cost items (the cost-code dropdown, fetched when a
  // job is picked).
  const jobId = (req.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (jobId) {
    try {
      // ONLY the lines JobTread will take an hour on. A cost code is not what
      // JobTread gates on — the cost ITEM's cost type is — so "01 51 20" can
      // have a Labor line and a Materials line, and the whole-budget list this
      // used to return offered both. Picking the wrong one failed at write
      // time, hours after the employee had gone home.
      //
      // `detail` rides along because that is the ONLY thing that tells two
      // lines under one code apart: `name` is the cost CODE's name and is
      // identical across them.
      const { items, filtered } = await getTimeTrackableLeaves(cfg, jobId);
      return NextResponse.json({
        ok: true,
        // false = the flag could not be read and this is the whole budget, so
        // the page must not promise that every line here will be accepted.
        laborOnly: filtered,
        costItems: items.map((b) => ({
          id: b.id,
          number: b.number,
          name: b.name,
          detail: b.detail,
          costType: b.costType,
        })),
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Could not load cost codes." },
        { status: 502 },
      );
    }
  }

  // Bootstrap: the signed-in user's linked JobTread identity + the org users and
  // pay types. The page's server shell already renders with all three when the
  // roster link is cached, so this GET is now the COLD path — the first load for
  // a person, or after their link expires. resolveJtUserLink writes what it
  // learns back to the DB, so the next load skips Apps Script entirely.
  const session = await auth();
  const email = session?.user?.email ?? "";
  const role = ((session?.user as { role?: string } | undefined)?.role ?? "").trim();

  // ADMIN ONLY: boot the page as someone else, so the whole screen — their
  // running clock, their timesheet — is theirs. Refused for every other role by
  // resolveTimeIdentity, not by hiding the parameter.
  const actingAs = (req.nextUrl.searchParams.get("actingAs") ?? "").trim();
  if (actingAs) {
    const who = await resolveTimeIdentity(actingAs);
    if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
    const [jtUsers, orgTypes] = await Promise.all([
      getOrgUsers(cfg).catch(() => []),
      getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
    ]);
    return NextResponse.json({
      ok: true,
      me: {
        name: who.identity.name,
        email: who.identity.subjectEmail,
        jtUserId: who.identity.jtUserId,
        jtUserName: who.identity.name,
      },
      acting: who.identity.acting,
      canActAs: role === "admin",
      jtUsers,
      orgTypes,
    });
  }

  const [link, jtUsers, orgTypes] = await Promise.all([
    resolveJtUserLink(email),
    getOrgUsers(cfg).catch(() => []),
    // Fallback pay-type list, used when the grant can't read each member's own
    // set (per-member types 403 → getOrgUsers returns them undefined).
    getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
  ]);

  // An unreachable roster is no longer an error: it just means we can't name the
  // person, and the page falls back to its one-time "who are you in JobTread?"
  // pick rather than showing a red banner over a working time clock.
  return NextResponse.json({
    ok: true,
    me: {
      name: link?.name ?? "",
      email: link?.email ?? email,
      jtUserId: link?.jtUserId ?? "",
      jtUserName: link?.jtUserName ?? "",
    },
    acting: false,
    canActAs: role === "admin",
    jtUsers,
    orgTypes,
  });
}

interface Photo {
  base64?: string;
  mimeType?: string;
  name?: string;
}
interface Body {
  clientKey?: string;
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

  // Attribute the entry to the signed-in user, never to anything the client sends.
  const session = await auth();
  const email = session?.user?.email ?? "";

  // Idempotency key: the phone generates one UUID per logical entry and resends
  // it on every retry. Bad service drops our RESPONSE, not the work, so a retry
  // must reconcile to the same row — never a second one. Fall back to a per-
  // request id only for older clients that don't send one (no dedupe, old
  // behavior). See the reserve-first flow below.
  const clientKey = (body.clientKey ?? "").trim() || `te-${crypto.randomUUID()}`;

  // WHOSE time this is. `userId` used to go straight to createTimeEntry, which
  // meant anyone could log hours against anyone. It now goes through the one
  // rule (src/lib/actingAs.ts): your own always, someone else's only as admin.
  const who = await resolveTimeIdentity((body.userId ?? "").trim());
  if (!who.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          who.status === 400 ? "No JobTread user — pick who you are in JobTread first." : who.error,
      },
      { status: who.status },
    );
  }
  const userId = who.identity.jtUserId;
  const acting = who.identity.acting;
  const jobId = (body.jobId ?? "").trim();
  const costItemId = (body.costItemId ?? "").trim();
  const note = (body.note ?? "").trim();
  const startLocal = toLocalStamp(body.startTime ?? "");
  const endLocal = toLocalStamp(body.endTime ?? "");
  const startedAt = orgLocalToJtIso(startLocal);
  const endedAt = orgLocalToJtIso(endLocal);

  if (!jobId) return NextResponse.json({ ok: false, error: "Pick a job." }, { status: 400 });
  if (!costItemId) return NextResponse.json({ ok: false, error: "Pick a cost code." }, { status: 400 });
  if (!note) return NextResponse.json({ ok: false, error: "A note is required." }, { status: 400 });
  if (!startedAt || !endedAt) {
    return NextResponse.json({ ok: false, error: "Enter a start and stop time." }, { status: 400 });
  }
  if (endedAt <= startedAt) {
    return NextResponse.json({ ok: false, error: "Stop time must be after the start time." }, { status: 400 });
  }
  // JobTread REQUIRES a type on createTimeEntry (confirmed — it 400s without
  // one), so only enforce it when a write is actually about to happen; the
  // preview (writes off) path doesn't call JobTread and can log without one.
  const payType = (body.payType ?? "").trim();
  if (writesEnabled() && !payType) {
    return NextResponse.json({ ok: false, error: "Pick a pay type." }, { status: 400 });
  }

  // Everything below is DETACHED — see the note at the top of this file. The
  // phone is answered now; the Drive upload, the Sheet row and the JobTread
  // write finish on the server.
  const photos = (body.photos ?? []).filter((p) => p && p.base64);
  after(async () => {
    // 1) RESERVE the durable record FIRST, keyed by clientKey. On a retry this
    //    returns the row already written (duplicate:true) instead of appending a
    //    second one — and, because we haven't touched JobTread yet, a replay never
    //    creates a duplicate JobTread entry either. Photos are saved here (once).
    const reserved = await callAppsScript({
      action: "logTimeEntry",
      clientKey,
      // The row is about the subject; `loggedBy` below is who really filed it.
      // An admin logging Dan's Tuesday writes Dan's name and email here and
      // their own in Logged By, so the sheet never claims Dan did it himself.
      employee: acting ? who.identity.name : (body.employee ?? ""),
      employeeEmail: acting ? who.identity.subjectEmail : email,
      jtUserId: userId,
      jobLabel: body.jobLabel ?? "",
      jobId,
      costCode: body.costCode ?? "",
      costItemId,
      payType: body.payType ?? "",
      startTime: startLocal,
      endTime: endLocal,
      note,
      jtEntryId: "",
      jtStatus: writesEnabled() ? "pending push" : "not pushed (writes off)",
      loggedBy: email,
      photos,
    });
    if (reserved.error) {
      console.error(`[employee-time] ${clientKey}: could not file the record:`, reserved.error);
      return;
    }
    const l = (reserved.data ?? {}) as {
      ok?: boolean;
      error?: string;
      duplicate?: boolean;
      entryId?: string;
      jtEntryId?: string;
      jtStatus?: string;
    };
    if (l?.ok === false) {
      console.error(`[employee-time] ${clientKey}: the record was refused:`, l.error ?? "");
      return;
    }

    // Replay of an entry we already handled — the outcome is already on the
    // row, so do NOT write to JobTread again.
    if (l.duplicate) return;

    // 2) First time for this key: create the JobTread entry (gated), then record
    //    its id/status back onto the reserved row. A JobTread failure never loses
    //    the record — the row already exists; we just mark why it didn't push.
    if (!writesEnabled()) return;
    let jtEntryId = "";
    let jtStatus = "pending push";
    try {
      const { id } = await createTimeEntry(getPaveConfig(), {
        userId,
        jobId,
        costItemId,
        startedAt,
        endedAt,
        type: payType,
        notes: note,
        isApproved: false,
      });
      jtEntryId = id;
      jtStatus = "pushed";
      // Hours filed on someone ELSE's behalf add labor cost to a job with no
      // other trace of who added it. Same reason /api/time-entry/create
      // journals its writes; an employee logging their own time does not.
      if (acting) {
        const j = await openJournal("/api/employee-time", { email, role: who.identity.role });
        await j.record([
          {
            action: "time-entry.create",
            entity: "time-entry",
            entityId: id,
            jobId,
            after: { userId, jobId, costItemId, startedAt, endedAt, type: payType, notes: note },
            beforeSource: "none",
            meta: { actingAs: who.identity.name, actingAsJtUserId: userId },
          },
        ]);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      jtStatus = "JobTread error: " + message;
      console.error(`[employee-time] ${clientKey}: JobTread refused the entry:`, message);
    }
    await callAppsScript({ action: "finalizeTimeEntryLog", clientKey, jtEntryId, jtStatus });
  });

  return NextResponse.json({
    ok: true,
    accepted: true,
    // Known without waiting for anything: the gate is read from the environment,
    // so the "writes are off" warning is still honest on an immediate answer.
    previewed: !writesEnabled(),
    photoCount: photos.length,
  });
}
