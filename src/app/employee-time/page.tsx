"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { JobPicker } from "@/components/JobPicker";
import { JtLink } from "@/components/JtLink";
import { fmtHM } from "@/lib/leaveFormat";
import {
  Banner,
  Card,
  EmptyState,
  Input,
  Label,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

/**
 * /employee-time — log hours to a JobTread job, three ways:
 *
 *  - Clock In/Out (default): tap in when you start, tap out when you stop. The
 *    tap-in creates an OPEN JobTread time entry (startedAt only); tap-out sets
 *    its endedAt + the required note (updateTimeEntry). The active clock is
 *    mirrored to localStorage (like /mileage-tracker's start/end trip) so
 *    locking the phone or closing the tab doesn't lose it.
 *  - Log a range: the original one-shot form — job + cost code + start/stop +
 *    note + photos, all picked upfront (for logging a specific past range).
 *  - My Time: the signed-in employee's own JobTread time entries for a
 *    bi-monthly pay period (1st–15th / 16th–end), each linking to its job in
 *    JobTread.
 *
 * The signed-in user is resolved to their linked JobTread user (via the
 * Employee roster), times default to now, and GPS pre-selects the nearest job
 * site. Every write is gated by COMPANION_WRITES_ENABLED (default preview); the
 * Time Entries sheet record + photos are saved either way.
 */

interface Me {
  name: string;
  email: string;
  jtUserId: string;
  jtUserName: string;
}
interface Site {
  label: string;
  lat: number;
  lng: number;
  jtJobId: string;
}
interface PayType {
  name: string;
  hourlyRate?: number;
}
interface UserRef {
  id: string;
  name: string;
  isInternal: boolean;
  types?: PayType[];
}
interface JobRef {
  id: string;
  name: string;
  customer?: string;
}
interface CostItem {
  id: string;
  number: string;
  name: string;
}
interface Photo {
  base64: string; // data URL
  mimeType: string;
  name: string;
}
interface SubmitResult {
  ok?: boolean;
  error?: string;
  previewed?: boolean;
  wrote?: boolean;
  jtStatus?: string;
  jtError?: string;
  entryId?: string;
  photoCount?: number;
}
interface ActiveClock {
  entryId: string;
  logKey: string; // idempotency key for the clock-out log — reused on every retry
  previewed: boolean;
  jtStatus: string;
  startedAt: string; // local "YYYY-MM-DDTHH:MM" sent at clock-in
  jobId: string;
  jobLabel: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  payType: string;
  lat?: number;
  lng?: number;
  nearestJob: string;
  employee: string;
}
interface DoneSummary {
  jobLabel: string;
  costLabel: string;
  payType: string;
  startTime: string;
  endTime: string;
  note: string;
}
interface HistoryEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  minutes: number;
  jobId: string;
  jobName: string;
  costCode: string;
  costItemName: string;
  notes: string;
  open: boolean;
  jtUrl: string;
}

const MAX_PHOTOS = 8;
const NEAR_KM = 1.2; // within this of a job site → treat you as "at" that job
const LS_JT_USER = "employeeTime.jtUser."; // + email → remembered JobTread user id
const LS_CLOCK = "employeeTime.activeClock";

const jobRefLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

// A fresh idempotency key for one logical time entry. The same key rides every
// retry of that entry (bad service drops the response, not the server's work),
// so the backend reconciles a retry to the same row instead of duplicating it.
const newLogKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? `te-${crypto.randomUUID()}`
    : `te-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Great-circle distance in km — to label the nearest job site.
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This device can't share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    });
  });
}

// Current local time as the "YYYY-MM-DDTHH:MM" an <input type="datetime-local">
// wants — today + now, by default. Also used for clock-in/out timestamps: a
// bare date-time string like this parses as LOCAL time in the browser (per the
// ECMA-262 Date spec — only date-ONLY strings parse as UTC), so start/end
// arithmetic below is safe without any timezone conversion.
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Same, but to the SECOND — used for clock in/out. JobTread rejects an entry
// whose end isn't strictly after its start ("The end time must be after the
// start time"), so minute precision would 400 on any clock-in/out inside the
// same minute. Seconds keep short sessions valid and record real duration.
function nowLocalSeconds(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${nowLocal()}:${p(d.getSeconds())}`;
}

// "YYYY-MM-DD" → "MM/DD/YYYY" for display. Passes anything that doesn't match
// straight through.
function fmtDate(ymd: string): string {
  const m = (ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ymd;
}

// Trim a "…THH:MM[:SS]" stamp to a friendly "MM/DD/YYYY HH:MM" for display.
function displayStamp(s: string): string {
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]} ${m[4]}:${m[5]}` : (s || "").slice(0, 16).replace("T", " ");
}

function fmtMinutes(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

function fmtDuration(startLocal: string, endLocal: string): string {
  const s = new Date(startLocal).getTime();
  const e = new Date(endLocal).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return "";
  return fmtMinutes(Math.round((e - s) / 60000));
}

// Today's YYYY-MM (for the pay-period month picker default).
function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Which half of the month today falls in.
function defaultHalf(): "a" | "b" {
  return new Date().getDate() <= 15 ? "a" : "b";
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
// "2026-07" + half → the inclusive YYYY-MM-DD range for that bi-monthly period.
function periodBounds(month: string, half: "a" | "b"): { start: string; end: string } {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return { start: "", end: "" };
  if (half === "a") return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-15` };
  const last = String(daysInMonth(Number(m[1]), Number(m[2]))).padStart(2, "0");
  return { start: `${m[1]}-${m[2]}-16`, end: `${m[1]}-${m[2]}-${last}` };
}

// Downscale a picked image to a JPEG data URL (max 1600px, quality 0.85) so a
// handful of phone photos stay a reasonable payload.
function downscale(file: File): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1600;
      let { width, height } = img;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process the image."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({
        base64: canvas.toDataURL("image/jpeg", 0.85),
        mimeType: "image/jpeg",
        name: (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg",
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a readable image."));
    };
    img.src = url;
  });
}

// Header title with a large "Beta" tag, shared across every module state
// (loading, done, main) so the flag reads consistently.
const EMPLOYEE_TIME_TITLE = (
  <span className="flex items-center gap-3">
    Employee Time
    <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-extrabold uppercase tracking-wider text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
      Beta
    </span>
  </span>
);

export default function EmployeeTimePage() {
  const [mode, setMode] = useState<"clock" | "manual" | "history">("clock");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reference data.
  const [me, setMe] = useState<Me | null>(null);
  const [jtUsers, setJtUsers] = useState<UserRef[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  // The job chosen in the JobPicker, captured via its onSelect so we can label
  // it without fetching /api/jobs a second time (the picker already has it).
  const [pickedJob, setPickedJob] = useState<JobRef | null>(null);
  // The signed-in user's PTO/sick balances, for the summary strip + link to
  // /time-off. Best-effort — a failure just hides the chips.
  const [leaveBal, setLeaveBal] = useState<{ leaveType: string; balance: number }[]>([]);

  // Who's logging — the roster link, or a one-time manual pick when unlinked.
  const [pickedUserId, setPickedUserId] = useState("");

  // Shared job/cost/pay-type context — used by both Clock and Manual modes.
  const [jobId, setJobId] = useState("");
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [costItemId, setCostItemId] = useState("");
  const [payType, setPayType] = useState("");

  // Manual-mode-only fields.
  const [startTime, setStartTime] = useState(nowLocal());
  const [endTime, setEndTime] = useState(nowLocal());

  // Shared note/photos — used by Manual (upfront) and Clock (at clock-out).
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);

  // GPS.
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [nearestJob, setNearestJob] = useState("");
  const [geoNote, setGeoNote] = useState("");
  const [gpsTried, setGpsTried] = useState(false);

  // Clock in/out.
  const [activeClock, setActiveClock] = useState<ActiveClock | null>(null);
  const [clockSubPhase, setClockSubPhase] = useState<"idle" | "clockingOut">("idle");
  const [nowMs, setNowMs] = useState(0);

  // Manual-mode idempotency key — one per logical submission, held here so a
  // retry after a dropped response reuses it (backend dedupes on it). Cleared on
  // success so "Log another" starts a new one.
  const manualKeyRef = useRef("");

  // My Time (history).
  const [historyMonth, setHistoryMonth] = useState(defaultMonth());
  const [historyHalf, setHistoryHalf] = useState<"a" | "b">(defaultHalf());
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyTotalMin, setHistoryTotalMin] = useState(0);
  const [historyOpenCount, setHistoryOpenCount] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState("");

  const [done, setDone] = useState<{ result: SubmitResult; summary: DoneSummary } | null>(null);

  // --- Bootstrap: linked JT identity, org users + pay types, job sites. -------
  // The job list itself is owned by the JobPicker (its own /api/jobs fetch) —
  // this page no longer fetches it separately; the picked job's label comes
  // back through JobPicker's onSelect.
  useEffect(() => {
    fetch("/api/employee-time")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) {
          setErr(j.error || "Couldn't load the page.");
          return;
        }
        setMe(j.me ?? null);
        setJtUsers(j.jtUsers ?? []);
        setOrgTypes(j.orgTypes ?? []);
        setSites(j.sites ?? []);
      })
      .catch(() => setErr("Couldn't reach the server."))
      .finally(() => setLoading(false));

    // Own PTO/sick balances for the summary strip (own-balance view).
    fetch("/api/time-off/me")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok !== false) setLeaveBal(j.balances ?? []);
      })
      .catch(() => {});

    // Resume an in-progress clock-in (survives a locked phone / closed tab).
    // Deliberately does NOT touch jobId/costItemId/payType — the clocked-in
    // context is rendered read-only from the saved record itself.
    try {
      const raw = localStorage.getItem(LS_CLOCK);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.startedAt && c.jobId && c.costItemId) {
          if (!c.logKey) c.logKey = newLogKey(); // clock-in from before this key existed
          setActiveClock(c);
        }
      }
    } catch {}
  }, []);

  // Remembered JobTread-user pick (only used when the roster link is missing).
  useEffect(() => {
    if (!me || me.jtUserId) return;
    try {
      const saved = localStorage.getItem(LS_JT_USER + (me.email || ""));
      if (saved) setPickedUserId(saved);
    } catch {}
  }, [me]);

  const effectiveUserId = (me?.jtUserId || pickedUserId || "").trim();
  const effectiveUser = useMemo(
    () => jtUsers.find((u) => u.id === effectiveUserId) ?? null,
    [jtUsers, effectiveUserId],
  );
  const effectiveName = me?.name || me?.jtUserName || effectiveUser?.name || "";

  function pickUser(id: string) {
    setPickedUserId(id);
    setPayType("");
    try {
      if (me?.email) localStorage.setItem(LS_JT_USER + me.email, id);
    } catch {}
  }

  // GPS → nearest job site, once the sites are loaded. Best-effort: a denied or
  // failed fix just means no pre-fill.
  useEffect(() => {
    if (!sites.length || gpsTried) return;
    setGpsTried(true);
    setGeoNote("Finding the nearest job…");
    getPosition()
      .then((pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGps(here);
        const scored = sites
          .map((s) => ({ s, d: haversineKm(here, { lat: s.lat, lng: s.lng }) }))
          .sort((a, b) => a.d - b.d);
        const near = scored[0];
        if (near && near.d <= NEAR_KM) {
          setJobId(near.s.jtJobId);
          setNearestJob(near.s.label);
          setGeoNote(`Nearest job pre-filled: ${near.s.label}`);
        } else {
          setGeoNote("No job site nearby — pick the job below.");
        }
      })
      .catch(() => setGeoNote(""));
  }, [sites, gpsTried]);

  // A job's cost codes (its budget cost items). Reload on job change.
  useEffect(() => {
    setCostItemId("");
    setCostItems([]);
    if (!jobId) return;
    setLoadingCosts(true);
    fetch(`/api/employee-time?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => setCostItems(j.ok === false ? [] : (j.costItems ?? [])))
      .catch(() => setCostItems([]))
      .finally(() => setLoadingCosts(false));
  }, [jobId]);

  // Pay type: the resolved user's OWN set when the grant can read it, else the
  // org-wide list as a fallback. Auto-set when there's exactly one option; a
  // dropdown shows only when there are several.
  const perMemberTypes = effectiveUser?.types;
  const payTypes: PayType[] = perMemberTypes ?? orgTypes.map((name) => ({ name }));
  const typesAreFallback = !perMemberTypes && orgTypes.length > 0;
  useEffect(() => {
    if (payType) return;
    if (payTypes.length === 1) setPayType(payTypes[0].name);
  }, [payTypes, payType]);

  // The selected job's label. Comes from the JobPicker pick (onSelect) when the
  // user chose one, else the GPS-prefilled nearest-site label — no jobs list
  // to look it up in anymore.
  const jobLabel = useMemo(() => {
    if (pickedJob && pickedJob.id === jobId) return jobRefLabel(pickedJob);
    return nearestJob;
  }, [pickedJob, jobId, nearestJob]);

  const selectedCost = costItems.find((c) => c.id === costItemId) ?? null;
  const duration = fmtDuration(startTime, endTime);

  // Elapsed time since clock-in, ticking every second while active.
  useEffect(() => {
    if (!activeClock) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeClock]);
  const elapsed = activeClock
    ? fmtMinutes(Math.max(0, Math.round((nowMs - new Date(activeClock.startedAt).getTime()) / 60000)))
    : "";

  async function addPhotos(list: FileList | null) {
    if (!list || !list.length) return;
    setErr("");
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setErr(`Up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const picked = Array.from(list).slice(0, room);
    const out: Photo[] = [];
    for (const f of picked) {
      try {
        out.push(await downscale(f));
      } catch {
        /* skip an unreadable file */
      }
    }
    if (out.length) setPhotos((prev) => [...prev, ...out]);
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ------------------------------------------------------------- Clock in/out
  async function clockIn() {
    setErr("");
    if (!effectiveUserId) {
      setErr("Pick who you are in JobTread first.");
      return;
    }
    if (!jobId) {
      setErr("Pick a job.");
      return;
    }
    if (!costItemId) {
      setErr("Pick a cost code.");
      return;
    }
    setBusy(true);
    try {
      const startedAt = nowLocalSeconds();
      const res = await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "in", userId: effectiveUserId, jobId, costItemId, payType, startTime: startedAt }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not clock in.");
        return;
      }
      const clock: ActiveClock = {
        entryId: json.entryId || "",
        logKey: newLogKey(), // reused on every clock-out retry for idempotency
        previewed: !!json.previewed,
        jtStatus: json.jtStatus || "",
        startedAt,
        jobId,
        jobLabel,
        costItemId,
        costCode: selectedCost?.number ?? "",
        costItemName: selectedCost?.name ?? "",
        payType,
        lat: gps?.lat,
        lng: gps?.lng,
        nearestJob,
        employee: effectiveName,
      };
      setActiveClock(clock);
      try {
        localStorage.setItem(LS_CLOCK, JSON.stringify(clock));
      } catch {}
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not clock in.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmClockOut() {
    if (!activeClock) return;
    if (!note.trim()) {
      setErr("A note is required.");
      return;
    }
    // JobTread requires end > start strictly; a sub-second session would 400.
    // That's a mis-tap, not real work — point at Cancel instead.
    const endedAt = nowLocalSeconds();
    if (endedAt <= activeClock.startedAt) {
      setErr("You've been clocked in less than a second — use “Cancel this clock-in” instead.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "out",
          clientKey: activeClock.logKey,
          entryId: activeClock.entryId,
          userId: effectiveUserId,
          employee: activeClock.employee,
          jobId: activeClock.jobId,
          jobLabel: activeClock.jobLabel,
          costItemId: activeClock.costItemId,
          costCode: activeClock.costCode,
          payType: activeClock.payType,
          startTime: activeClock.startedAt,
          endTime: endedAt,
          note: note.trim(),
          lat: activeClock.lat,
          lng: activeClock.lng,
          nearestJob: activeClock.nearestJob,
          photos,
        }),
      });
      const json: SubmitResult = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not clock out.");
        return;
      }
      setDone({
        result: json,
        summary: {
          jobLabel: activeClock.jobLabel,
          costLabel: [activeClock.costCode, activeClock.costItemName].filter(Boolean).join(" — "),
          payType: activeClock.payType,
          startTime: activeClock.startedAt,
          endTime: endedAt,
          note: note.trim(),
        },
      });
      try {
        localStorage.removeItem(LS_CLOCK);
      } catch {}
      setActiveClock(null);
      setClockSubPhase("idle");
      setNote("");
      setPhotos([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not clock out.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelClockIn() {
    if (!activeClock) return;
    setBusy(true);
    try {
      await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "cancel", entryId: activeClock.entryId }),
      });
    } catch {}
    try {
      localStorage.removeItem(LS_CLOCK);
    } catch {}
    setActiveClock(null);
    setClockSubPhase("idle");
    setErr("");
    setBusy(false);
  }

  // ------------------------------------------------------------- Manual mode
  const submit = useCallback(async () => {
    setErr("");
    if (!effectiveUserId) {
      setErr("Pick who you are in JobTread first.");
      return;
    }
    if (!jobId) {
      setErr("Pick a job.");
      return;
    }
    if (!costItemId) {
      setErr("Pick a cost code.");
      return;
    }
    if (!note.trim()) {
      setErr("A note is required.");
      return;
    }
    if (!startTime || !endTime) {
      setErr("Enter a start and stop time.");
      return;
    }
    if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      setErr("Stop time must be after the start time.");
      return;
    }

    // Reuse the same key across retries of THIS submission; a new one starts
    // only after a clean success (cleared below / in logAnother).
    if (!manualKeyRef.current) manualKeyRef.current = newLogKey();

    setBusy(true);
    try {
      const res = await fetch("/api/employee-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: manualKeyRef.current,
          userId: effectiveUserId,
          employee: effectiveName,
          jobId,
          jobLabel,
          costItemId,
          costCode: selectedCost?.number ?? "",
          payType,
          startTime,
          endTime,
          note: note.trim(),
          lat: gps?.lat,
          lng: gps?.lng,
          nearestJob,
          photos,
        }),
      });
      const json: SubmitResult = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not save the time entry.");
        return;
      }
      manualKeyRef.current = ""; // clean success → next submission gets a new key
      setDone({
        result: json,
        summary: {
          jobLabel,
          costLabel: selectedCost ? `${selectedCost.number} ${selectedCost.name}`.trim() : "",
          payType,
          startTime,
          endTime,
          note: note.trim(),
        },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the time entry.");
    } finally {
      setBusy(false);
    }
  }, [
    effectiveUserId,
    effectiveName,
    jobId,
    jobLabel,
    costItemId,
    selectedCost,
    payType,
    startTime,
    endTime,
    note,
    gps,
    nearestJob,
    photos,
  ]);

  function logAnother() {
    setDone(null);
    setNote("");
    setPhotos([]);
    setErr("");
    if (mode === "manual") {
      setJobId("");
      setPickedJob(null);
      setCostItemId("");
      setStartTime(nowLocal());
      setEndTime(nowLocal());
    }
  }

  // ------------------------------------------------------------------ My Time
  const loadHistory = useCallback(async () => {
    const { start, end } = periodBounds(historyMonth, historyHalf);
    if (!start || !end) return;
    setHistoryLoading(true);
    setHistoryErr("");
    try {
      const res = await fetch(`/api/employee-time/history?start=${start}&end=${end}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setHistoryErr(json.error || "Could not load your time.");
        setHistoryEntries([]);
        return;
      }
      setHistoryEntries(json.entries ?? []);
      setHistoryTotalMin(json.totalMinutes ?? 0);
      setHistoryOpenCount(json.openCount ?? 0);
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : "Could not load your time.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyMonth, historyHalf]);

  useEffect(() => {
    if (mode === "history") loadHistory();
  }, [mode, loadHistory]);

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title={EMPLOYEE_TIME_TITLE} description="Log your hours to a job." />
        <Loading label="Loading…" />
      </main>
    );
  }

  // ---------------------------------------------------------------- DONE ------
  if (done) {
    const dur = fmtDuration(done.summary.startTime, done.summary.endTime);
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title={EMPLOYEE_TIME_TITLE} description="Log your hours to a job." />
        <div className="space-y-4">
          <Card className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Time logged
            </p>
            <div className="mt-1 text-3xl font-bold tabular-nums">{dur || "—"}</div>
            {done.summary.jobLabel && <p className="mt-1 text-sm text-neutral-500">{done.summary.jobLabel}</p>}
          </Card>

          {done.result.previewed ? (
            <Banner tone="warning">
              Saved to the Time Entries record. JobTread push is OFF
              (COMPANION_WRITES_ENABLED not set) — nothing was written to JobTread.
            </Banner>
          ) : done.result.wrote ? (
            <Banner tone="success">Pushed to JobTread and saved to the record.</Banner>
          ) : (
            <Banner tone="warning">
              Saved to the record, but the JobTread push failed
              {done.result.jtError ? `: ${done.result.jtError}` : ""}. The office can retry it.
            </Banner>
          )}

          <Card className="space-y-2 text-sm">
            {effectiveName && <Row label="Who" value={effectiveName} />}
            {done.summary.costLabel && <Row label="Cost" value={done.summary.costLabel} />}
            {done.summary.payType && <Row label="Type" value={done.summary.payType} />}
            <Row label="Start" value={displayStamp(done.summary.startTime)} />
            <Row label="Stop" value={displayStamp(done.summary.endTime)} />
            {done.summary.note && <Row label="Note" value={done.summary.note} />}
            {done.result.photoCount ? <Row label="Photos" value={`${done.result.photoCount} saved`} /> : null}
          </Card>

          <button
            type="button"
            onClick={logAnother}
            className="w-full rounded-2xl bg-accent px-4 py-5 text-base font-bold text-accent-fg shadow-sm transition hover:bg-accent-hover"
          >
            Log another
          </button>
        </div>
      </main>
    );
  }

  const needsUserPick = !!me && !me.jtUserId;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title={EMPLOYEE_TIME_TITLE}
        description="Log your hours to a job — with a note and photos."
      />

      {/* Mode selector. */}
      <div className="mb-4 flex gap-2">
        <ModeTab active={mode === "clock"} onClick={() => setMode("clock")}>
          Clock In/Out
        </ModeTab>
        <ModeTab active={mode === "manual"} onClick={() => setMode("manual")}>
          Log a range
        </ModeTab>
        <ModeTab active={mode === "history"} onClick={() => setMode("history")}>
          My Time
        </ModeTab>
      </div>

      {/* PTO / sick balance summary + link to the full Time Off page. */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3">
          {leaveBal.length ? (
            <div className="flex items-center gap-6">
              {(["sick", "pto"] as const).map((t) => {
                const b = leaveBal.find((x) => x.leaveType === t);
                return (
                  <div key={t}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      {t === "sick" ? "Sick" : "PTO"}
                    </div>
                    <div className="text-lg font-bold tabular-nums">
                      {b ? fmtHM(b.balance) : "0h"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-neutral-500">Time off</div>
          )}
          <Link
            href="/time-off"
            className="shrink-0 text-sm font-semibold text-accent hover:underline dark:text-accent-soft"
          >
            View &amp; request →
          </Link>
        </div>
      </Card>

      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      {/* Who — the signed-in user, or a one-time pick when unlinked. Shown for
          both logging modes, not history. */}
      {mode !== "history" &&
        (needsUserPick ? (
          <Card className="mb-4 space-y-2">
            <Label htmlFor="et-user">Who are you in JobTread?</Label>
            <Select id="et-user" value={pickedUserId} onChange={(e) => pickUser(e.target.value)}>
              <option value="">Select yourself…</option>
              {jtUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.isInternal ? "★ " : "") + u.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-neutral-500">
              We couldn&apos;t match your login to a JobTread user. Pick yourself once — it&apos;s
              remembered on this device. (An admin can link you on the Employees page to skip this.)
            </p>
          </Card>
        ) : (
          effectiveName && (
            <p className="mb-4 text-sm text-neutral-500">
              Logging time as{" "}
              <span className="font-semibold text-neutral-700 dark:text-neutral-200">{effectiveName}</span>
            </p>
          )
        ))}

      {/* --------------------------------------------------------- CLOCK MODE */}
      {mode === "clock" &&
        (activeClock ? (
          <div className="space-y-4">
            <Card className="text-center">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-accent dark:text-accent-soft">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden />
                Clocked in
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{elapsed || "0 min"}</div>
              <p className="mt-1 text-sm text-neutral-500">{activeClock.jobLabel}</p>
              <p className="text-xs text-neutral-400">
                {[activeClock.costCode, activeClock.costItemName].filter(Boolean).join(" — ")}
                {activeClock.payType ? ` · ${activeClock.payType}` : ""}
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Started {displayStamp(activeClock.startedAt)}
              </p>
              {activeClock.previewed && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  JobTread push is OFF — this clock is local-only until writes are enabled.
                </p>
              )}
            </Card>

            {clockSubPhase === "idle" ? (
              <>
                <button
                  type="button"
                  onClick={() => setClockSubPhase("clockingOut")}
                  disabled={busy}
                  className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-accent-fg shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clock out
                </button>
                <button
                  type="button"
                  onClick={cancelClockIn}
                  disabled={busy}
                  className="mx-auto block text-xs text-neutral-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40"
                >
                  Cancel this clock-in
                </button>
              </>
            ) : (
              <>
                <Card className="space-y-4">
                  <div>
                    <Label htmlFor="et-clockout-note">Note (required)</Label>
                    <Textarea
                      id="et-clockout-note"
                      rows={3}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What did you work on?"
                    />
                  </div>
                  <PhotoPicker photos={photos} onAdd={addPhotos} onRemove={removePhoto} />
                </Card>

                <button
                  type="button"
                  onClick={confirmClockOut}
                  disabled={busy}
                  className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-accent-fg shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Confirm clock out"}
                </button>
                <button
                  type="button"
                  onClick={() => setClockSubPhase("idle")}
                  disabled={busy}
                  className="mx-auto block text-xs text-neutral-500 underline-offset-2 hover:text-accent hover:underline disabled:opacity-40 dark:hover:text-accent-soft"
                >
                  Back
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Card className="space-y-4">
              <div>
                <Label>Job</Label>
                <div className="flex">
                  <JobPicker value={jobId} onChange={setJobId} onSelect={setPickedJob} />
                </div>
                {geoNote && <p className="mt-1 text-xs text-neutral-500">{geoNote}</p>}
              </div>

              <div>
                <Label htmlFor="et-cost-clock">Cost code</Label>
                <Select
                  id="et-cost-clock"
                  value={costItemId}
                  onChange={(e) => setCostItemId(e.target.value)}
                  disabled={!jobId || loadingCosts}
                >
                  <option value="">
                    {!jobId
                      ? "Pick a job first…"
                      : loadingCosts
                        ? "Loading cost codes…"
                        : costItems.length
                          ? "Select a cost code…"
                          : "No cost codes on this job"}
                  </option>
                  {costItems.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number}
                      {c.name ? ` — ${c.name}` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              {payTypes.length > 1 && (
                <div>
                  <Label htmlFor="et-type-clock">Pay type</Label>
                  <Select id="et-type-clock" value={payType} onChange={(e) => setPayType(e.target.value)}>
                    <option value="">Select a pay type…</option>
                    {payTypes.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                        {typeof t.hourlyRate === "number" ? ` ($${t.hourlyRate}/hr)` : ""}
                      </option>
                    ))}
                  </Select>
                  {typesAreFallback && (
                    <p className="mt-1 text-xs text-neutral-500">
                      Showing all pay types — pick your rate for this job.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <button
              type="button"
              onClick={clockIn}
              disabled={busy}
              className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-accent-fg shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Clocking in…" : "Clock in"}
            </button>
          </div>
        ))}

      {/* -------------------------------------------------------- MANUAL MODE */}
      {mode === "manual" && (
        <div className="space-y-4">
          <Card className="space-y-4">
            <div>
              <Label>Job</Label>
              <div className="flex">
                <JobPicker value={jobId} onChange={setJobId} onSelect={setPickedJob} />
              </div>
              {geoNote && <p className="mt-1 text-xs text-neutral-500">{geoNote}</p>}
            </div>

            <div>
              <Label htmlFor="et-cost">Cost code</Label>
              <Select
                id="et-cost"
                value={costItemId}
                onChange={(e) => setCostItemId(e.target.value)}
                disabled={!jobId || loadingCosts}
              >
                <option value="">
                  {!jobId
                    ? "Pick a job first…"
                    : loadingCosts
                      ? "Loading cost codes…"
                      : costItems.length
                        ? "Select a cost code…"
                        : "No cost codes on this job"}
                </option>
                {costItems.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.number}
                    {c.name ? ` — ${c.name}` : ""}
                  </option>
                ))}
              </Select>
            </div>

            {payTypes.length > 1 && (
              <div>
                <Label htmlFor="et-type">Pay type</Label>
                <Select id="et-type" value={payType} onChange={(e) => setPayType(e.target.value)}>
                  <option value="">Select a pay type…</option>
                  {payTypes.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                      {typeof t.hourlyRate === "number" ? ` ($${t.hourlyRate}/hr)` : ""}
                    </option>
                  ))}
                </Select>
                {typesAreFallback && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Showing all pay types — pick your rate for this job.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="et-start">Start</Label>
                <Input
                  id="et-start"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="et-end">Stop</Label>
                <Input
                  id="et-end"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            {duration && <p className="-mt-1 text-xs text-neutral-500">{duration}</p>}

            <div>
              <Label htmlFor="et-note">Note (required)</Label>
              <Textarea
                id="et-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you work on?"
              />
            </div>

            <PhotoPicker photos={photos} onAdd={addPhotos} onRemove={removePhoto} />
          </Card>

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-accent-fg shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Log time"}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------- HISTORY MODE */}
      {mode === "history" && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <Label htmlFor="et-hist-month">Month</Label>
              <Input
                id="et-hist-month"
                type="month"
                value={historyMonth}
                onChange={(e) => setHistoryMonth(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <HalfTab active={historyHalf === "a"} onClick={() => setHistoryHalf("a")}>
                1–15
              </HalfTab>
              <HalfTab active={historyHalf === "b"} onClick={() => setHistoryHalf("b")}>
                16–end
              </HalfTab>
            </div>
          </Card>

          <Card className="text-center">
            <div className="text-3xl font-bold tabular-nums">{fmtMinutes(historyTotalMin) || "0 min"}</div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {historyEntries.length} entr{historyEntries.length === 1 ? "y" : "ies"}
              {historyOpenCount ? ` · ${historyOpenCount} still clocked in` : ""}
            </p>
          </Card>

          {historyErr && <Banner tone="error">{historyErr}</Banner>}

          {historyLoading ? (
            <Loading label="Loading your time…" />
          ) : historyEntries.length === 0 ? (
            <EmptyState>No time logged for this period.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {historyEntries.map((e) => (
                <HistoryRow key={e.id} e={e} />
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition " +
        (active
          ? "bg-accent text-accent-fg shadow-sm"
          : "border border-neutral-200 text-neutral-600 hover:border-accent dark:border-neutral-700/60 dark:text-neutral-300")
      }
    >
      {children}
    </button>
  );
}

function HalfTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-4 py-1.5 text-sm font-semibold transition " +
        (active
          ? "bg-accent text-accent-fg"
          : "border border-neutral-300 text-neutral-600 dark:border-neutral-600 dark:text-neutral-300")
      }
    >
      {children}
    </button>
  );
}

function PhotoPicker({
  photos,
  onAdd,
  onRemove,
}: {
  photos: Photo[];
  onAdd: (list: FileList | null) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div>
      <Label>Photos (optional)</Label>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div
            key={i}
            className="relative h-20 w-20 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.base64} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white"
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 text-2xl text-neutral-400 transition hover:border-accent hover:text-accent dark:border-neutral-600">
            +
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onAdd(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}

function HistoryRow({ e }: { e: HistoryEntry }) {
  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{fmtDate(e.date)}</div>
          <div className="truncate text-xs text-neutral-500">
            {e.jobName && e.jtUrl ? (
              <JtLink href={e.jtUrl} className="hover:underline">
                {e.jobName} ↗
              </JtLink>
            ) : (
              e.jobName || "—"
            )}
          </div>
          {(e.costCode || e.costItemName) && (
            <div className="truncate text-xs text-neutral-400">
              {[e.costCode, e.costItemName].filter(Boolean).join(" — ")}
            </div>
          )}
          {e.notes && <div className="mt-0.5 truncate text-xs text-neutral-400">{e.notes}</div>}
        </div>
        <div className="shrink-0 text-right">
          {e.minutes > 0 && (
            <div className="text-sm font-bold tabular-nums">{fmtMinutes(e.minutes)}</div>
          )}
          <div className="text-xs text-neutral-500 tabular-nums">
            {e.startTime}–{e.endTime || "…"}
          </div>
          {e.open && <div className="text-[10px] uppercase tracking-wide text-amber-500">clocked in</div>}
        </div>
      </div>
    </li>
  );
}
