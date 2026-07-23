import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getJobBudget,
  getOrgUsers,
  getOrgTimeEntryTypeNames,
  createTimeEntry,
} from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Backend for the Assistant's /employee-time page — logging a specific time
 * range in one shot (job + cost code + start/stop + a required note + optional
 * photos). The clock-in/out flow is the sibling route ./clock/route.ts; the
 * bi-monthly "my time" list is ./history/route.ts.
 *
 * This route straddles both systems. JobTread reads/writes go direct through the
 * grant-holding lib (@/lib/jobtread): the org users + their pay types, a job's
 * cost items, and the createTimeEntry write. Everything only Apps Script can do —
 * resolving the signed-in email to its linked JobTread user id, the job-site GPS
 * for the nearest-job pre-fill, storing the photos in Drive, and appending the
 * auditable "Time Entries" row — goes over the shared-secret web app.
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
 *   GET                → { ok, me, sites, jtUsers }              (page bootstrap)
 *   GET ?jobId=<id>    → { ok, costItems:[{id, number, name}] }  (cost-code list)
 *   POST { userId, jobId, jobLabel?, costItemId, costCode?, payType?, startTime,
 *          endTime, note, lat?, lng?, nearestJob?, employee?,
 *          photos:[{base64, mimeType, name}] }
 *        → { ok, previewed, wrote, jtEntryId, jtStatus, jtError?, entryId,
 *            photoCount, date }
 */
export const dynamic = "force-dynamic";

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    // Apps Script answers via a 302 to a one-time content URL, always HTTP 200
    // there — success/failure is the `ok` field in the body.
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

// datetime-local ("YYYY-MM-DDTHH:MM") → the floating local wall-clock ISO
// JobTread stores (no Z / offset — see toIso in labor-import). "" if unparseable.
function toFloatingIso(v: string): string {
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
      const items = await getJobBudget(cfg, jobId);
      return NextResponse.json({
        ok: true,
        costItems: items.map((b) => ({ id: b.id, number: b.number, name: b.name })),
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Could not load cost codes." },
        { status: 502 },
      );
    }
  }

  // Bootstrap: the signed-in user's linked JobTread identity + the job-site GPS
  // (Apps Script), and the org users/pay-types (JobTread).
  const session = await auth();
  const email = session?.user?.email ?? "";

  const [boot, jtUsers, orgTypes] = await Promise.all([
    callAppsScript({ action: "timeEntryBootstrap", email }),
    getOrgUsers(cfg).catch(() => []),
    // Fallback pay-type list, used when the grant can't read each member's own
    // set (per-member types 403 → getOrgUsers returns them undefined).
    getOrgTimeEntryTypeNames(cfg).catch(() => [] as string[]),
  ]);
  if (boot.error) return NextResponse.json({ ok: false, error: boot.error }, { status: boot.status });
  const b = (boot.data ?? {}) as { ok?: boolean; error?: string; me?: unknown; sites?: unknown };
  if (b?.ok === false) return NextResponse.json(b, { status: 200 });

  return NextResponse.json({
    ok: true,
    me: b.me ?? { name: "", email, jtUserId: "", jtUserName: "" },
    sites: b.sites ?? [],
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

  // Attribute the entry to the signed-in user, never to anything the client sends.
  const session = await auth();
  const email = session?.user?.email ?? "";

  const userId = (body.userId ?? "").trim();
  const jobId = (body.jobId ?? "").trim();
  const costItemId = (body.costItemId ?? "").trim();
  const note = (body.note ?? "").trim();
  const startedAt = toFloatingIso(body.startTime ?? "");
  const endedAt = toFloatingIso(body.endTime ?? "");

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "No JobTread user — pick who you are in JobTread first." },
      { status: 400 },
    );
  }
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

  // 1) Create the JobTread time entry (gated). Never lose the record over a JT
  //    failure — capture the outcome and still log below.
  let jtEntryId = "";
  let jtStatus = "";
  let jtError = "";
  if (writesEnabled()) {
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
    } catch (e) {
      jtError = e instanceof Error ? e.message : "Unknown error";
      jtStatus = "JobTread error: " + jtError;
    }
  } else {
    jtStatus = "not pushed (writes off)";
  }

  // 2) Always store the photos + the auditable row (the durable office record).
  const photos = (body.photos ?? []).filter((p) => p && p.base64);
  const logged = await callAppsScript({
    action: "logTimeEntry",
    employee: body.employee ?? "",
    employeeEmail: email,
    jtUserId: userId,
    jobLabel: body.jobLabel ?? "",
    jobId,
    costCode: body.costCode ?? "",
    costItemId,
    payType: body.payType ?? "",
    startTime: startedAt,
    endTime: endedAt,
    note,
    lat: body.lat ?? "",
    lng: body.lng ?? "",
    nearestJob: body.nearestJob ?? "",
    jtEntryId,
    jtStatus,
    loggedBy: email,
    photos,
  });
  if (logged.error) {
    return NextResponse.json(
      { ok: false, error: logged.error, jtEntryId, jtStatus, jtError },
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
    return NextResponse.json({ ...l, jtEntryId, jtStatus, jtError }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    previewed: !writesEnabled(),
    wrote: !!jtEntryId,
    jtEntryId,
    jtStatus,
    jtError: jtError || undefined,
    entryId: l.entryId ?? "",
    date: l.date ?? "",
    photoCount: l.photoCount ?? 0,
  });
}
