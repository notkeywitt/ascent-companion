"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { jobAddress, jobLabel as jobRefLabel, type JobRef } from "@/components/JobPicker";
import { JtLink } from "@/components/JtLink";
import { fmtHM } from "@/lib/leaveFormat";
import {
  Banner,
  Card,
  EmptyState,
  IconButton,
  Input,
  Label,
  Loading,
  PageHeader,
  Textarea,
} from "@/components/ui";

/**
 * /employee-time — the field crew's time clock, laid out like the phone
 * time-tracking apps the crew already knows (QuickBooks Workforce): two tabs,
 * a stack of tap-through field rows, and one big docked action button.
 *
 *  - TIME CLOCK (default): the big "Clocked out / Clocked in" state, the start
 *    time as tappable Today + time chips, then Job → Cost code → Pay type →
 *    Note as rows that each open a bottom sheet picker. The docked pill clocks
 *    in; while running it becomes Clock out and the elapsed time counts up.
 *    Clock-in creates an OPEN JobTread time entry (startedAt only); clock-out
 *    sets its endedAt + the required note (updateTimeEntry). The running clock
 *    is resumed FROM JOBTREAD on load (GET /api/employee-time/clock returns the
 *    open entry), so opening the page anywhere — a new phone, a cleared
 *    browser, the office desktop — shows Clock out with the real start time and
 *    job/cost code. It's also mirrored to localStorage (like /mileage-tracker's
 *    start/end trip) as the offline fallback and to carry what JobTread doesn't
 *    hold (the clock-in GPS fix, the log's idempotency key); JobTread wins on
 *    any disagreement.
 *  - TIMESHEETS: the signed-in employee's own JobTread entries for a bi-monthly
 *    pay period (1st–15th / 16th–end), grouped by day with the day's total and
 *    its JobTread approval state, each row linking to JobTread.
 *  - The "+" beside the docked pill opens "Log a range" — the one-shot form for
 *    time already worked (job + cost code + start/stop + note + photos).
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
  resumed?: boolean; // rebuilt from JobTread, not from this device's clock-in
}
// GET /api/employee-time/clock — the running clock as JobTread has it.
interface OpenEntry {
  entryId: string;
  startedAt: string; // org-local wall clock
  jobId: string;
  jobLabel: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  payType: string;
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
  customer: string;
  costCode: string;
  costItemName: string;
  notes: string;
  approved: boolean;
  open: boolean;
  jtUrl: string;
}
/** The bottom sheets this page can show; null = none open. */
type SheetId = "job" | "cost" | "type" | "note" | "out" | "manual" | "user" | null;

/** One day of the timesheet: its entries, its total, and its approval state. */
interface DayGroup {
  date: string;
  entries: HistoryEntry[];
  minutes: number;
  approved: boolean;
  anyOpen: boolean;
}

const MAX_PHOTOS = 8;
const NEAR_KM = 1.2; // within this of a job site → treat you as "at" that job
const LS_JT_USER = "employeeTime.jtUser."; // + email → remembered JobTread user id
const LS_CLOCK = "employeeTime.activeClock";

// A fresh idempotency key for one logical time entry. The same key rides every
// retry of that entry (bad service drops the response, not the server's work),
// so the backend reconciles a retry to the same row instead of duplicating it.
const newLogKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? `te-${crypto.randomUUID()}`
    : `te-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Mirror the running clock to this device. Not the source of truth (JobTread is
// — see the resume effect), but it keeps the clock alive offline and holds the
// two things JobTread never sees: the clock-in GPS fix and the log key.
function saveClock(c: ActiveClock) {
  try {
    localStorage.setItem(LS_CLOCK, JSON.stringify(c));
  } catch {}
}

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

// "YYYY-MM-DD" → the local Date at noon: midday, so a DST shift can never pull
// the date back over a day boundary when it's only being used for its label.
function ymdToDate(ymd: string): Date | null {
  const m = (ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}

// "13:23" → "1:23 pm" — the timesheet/chip time format the crew reads.
function fmt12h(hhmm: string): string {
  const m = (hhmm || "").match(/^(\d{2}):(\d{2})/);
  if (!m) return hhmm || "";
  const h = Number(m[1]);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

// The date chip's face: Today / Yesterday / "Aug 12" for anything older.
function dayChipLabel(ymd: string): string {
  const d = ymdToDate(ymd);
  if (!d) return ymd;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "2026-07-03" → "Fri, Jul 03" — the timesheet day heading.
function dayHeading(ymd: string): string {
  const d = ymdToDate(ymd);
  return d
    ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit" })
    : ymd;
}

// Trim a "…THH:MM[:SS]" stamp to a friendly "MM/DD/YYYY h:mm am" for display.
function displayStamp(s: string): string {
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]} ${fmt12h(`${m[4]}:${m[5]}`)}` : (s || "").slice(0, 16).replace("T", " ");
}

function fmtMinutes(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtDuration(startLocal: string, endLocal: string): string {
  const s = new Date(startLocal).getTime();
  const e = new Date(endLocal).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return "";
  return fmtMinutes(Math.round((e - s) / 60000));
}

// The running clock's face — H:MM:SS, counting seconds so it visibly moves.
function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
// "2026-07" ± n months, staying a valid "YYYY-MM".
function shiftMonth(month: string, delta: number): string {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string): string {
  const d = ymdToDate(`${month}-01`);
  return d ? d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : month;
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
  const [tab, setTab] = useState<"clock" | "sheets">("clock");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reference data.
  const [me, setMe] = useState<Me | null>(null);
  const [jtUsers, setJtUsers] = useState<UserRef[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [jobs, setJobs] = useState<JobRef[]>([]);
  // The signed-in user's PTO/sick balances, for the summary strip + link to
  // /time-off. Best-effort — a failure just hides the chips.
  const [leaveBal, setLeaveBal] = useState<{ leaveType: string; balance: number }[]>([]);

  // Who's logging — the roster link, or a one-time manual pick when unlinked.
  const [pickedUserId, setPickedUserId] = useState("");

  // Shared job/cost/pay-type context — used by the clock and by Log a range.
  const [jobId, setJobId] = useState("");
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [costItemId, setCostItemId] = useState("");
  const [payType, setPayType] = useState("");

  // The clock's own start time. Follows the wall clock until the crew member
  // edits a chip (startTouched) — that's the "I forgot to clock in at 7" case.
  const [startAt, setStartAt] = useState(nowLocal());
  const [startTouched, setStartTouched] = useState(false);

  // Log-a-range-only fields.
  const [startTime, setStartTime] = useState(nowLocal());
  const [endTime, setEndTime] = useState(nowLocal());

  // Shared note/photos — used by Log a range (upfront) and the clock (the note
  // can be written before clocking in; it's required to clock out).
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);

  // Which bottom sheet is open, if any — and which one to fall back to when it
  // closes. A picker opened from inside "Log a range" replaces that sheet, so
  // it has to hand the screen back rather than dumping you on the page.
  const [sheet, setSheet] = useState<SheetId>(null);
  const [returnSheet, setReturnSheet] = useState<SheetId>(null);

  // GPS.
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [nearestJob, setNearestJob] = useState("");
  const [geoNote, setGeoNote] = useState("");
  const [gpsTried, setGpsTried] = useState(false);

  // Clock in/out.
  const [activeClock, setActiveClock] = useState<ActiveClock | null>(null);
  const [nowMs, setNowMs] = useState(0);
  // The JobTread resume check (see the mount effect): gates the first render so
  // a running clock never flashes the "Clock in" form, and carries the note we
  // show when JobTread disagreed with this device.
  const [clockChecked, setClockChecked] = useState(false);
  const [clockNote, setClockNote] = useState("");

  // Log-a-range idempotency key — one per logical submission, held here so a
  // retry after a dropped response reuses it (backend dedupes on it). Cleared on
  // success so "Log another" starts a new one.
  const manualKeyRef = useRef("");

  // Timesheets.
  const [historyMonth, setHistoryMonth] = useState(defaultMonth());
  const [historyHalf, setHistoryHalf] = useState<"a" | "b">(defaultHalf());
  const [openOnly, setOpenOnly] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyTotalMin, setHistoryTotalMin] = useState(0);
  const [historyOpenCount, setHistoryOpenCount] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState("");

  const [done, setDone] = useState<{ result: SubmitResult; summary: DoneSummary } | null>(null);

  // --- Bootstrap: linked JT identity, org users + pay types, job sites, jobs. -
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

    // The job list feeds the Job sheet AND labels a GPS-prefilled job, so the
    // page holds it itself rather than hiding it inside a dropdown component.
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});

    // Own PTO/sick balances for the summary strip (own-balance view).
    fetch("/api/time-off/me")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok !== false) setLeaveBal(j.balances ?? []);
      })
      .catch(() => {});

    // Resume an in-progress clock-in. JobTread is the source of truth for "am I
    // on the clock" — an OPEN entry (no endedAt) IS the running clock — so this
    // resumes on ANY device, not just the phone that clocked in. localStorage is
    // read first (instant, and the only record when writes are off or the
    // network is down), then reconciled against JobTread's answer.
    //
    // Deliberately does NOT touch jobId/costItemId/payType — the clocked-in
    // context is rendered read-only from the resolved record itself.
    let local: ActiveClock | null = null;
    try {
      const raw = localStorage.getItem(LS_CLOCK);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.startedAt && c.jobId && c.costItemId) {
          if (!c.logKey) c.logKey = newLogKey(); // clock-in from before this key existed
          local = c as ActiveClock;
          setActiveClock(local);
        }
      }
    } catch {}

    fetch("/api/employee-time/clock")
      .then((r) => r.json())
      .then((j: { ok?: boolean; linked?: boolean; openEntry?: OpenEntry | null }) => {
        if (j.ok === false) return; // can't tell — leave the local record alone
        const remote = j.openEntry ?? null;

        if (remote) {
          if (local && local.entryId === remote.entryId) {
            // Same clock, seen from the device that started it. Keep what only
            // this device knows (the GPS fix, the log's idempotency key), but
            // let JobTread's copy win on everything it owns — it reflects any
            // edit the office made to the entry since clock-in.
            const merged: ActiveClock = {
              ...local,
              startedAt: remote.startedAt || local.startedAt,
              jobId: remote.jobId || local.jobId,
              jobLabel: remote.jobLabel || local.jobLabel,
              costItemId: remote.costItemId || local.costItemId,
              costCode: remote.costCode || local.costCode,
              costItemName: remote.costItemName || local.costItemName,
              payType: remote.payType || local.payType,
            };
            setActiveClock(merged);
            saveClock(merged);
            return;
          }
          // A clock this device has never seen (new phone, cleared browser, or
          // clocked in somewhere else). Rebuild it from JobTread. The log key is
          // DERIVED FROM THE ENTRY ID, not random, so if two devices both clock
          // out of the same entry the Time Entries log dedupes to one row.
          const resumedClock: ActiveClock = {
            entryId: remote.entryId,
            logKey: `te-jt-${remote.entryId}`,
            previewed: false, // it exists in JobTread by definition
            jtStatus: "pushed",
            startedAt: remote.startedAt,
            jobId: remote.jobId,
            jobLabel: remote.jobLabel,
            costItemId: remote.costItemId,
            costCode: remote.costCode,
            costItemName: remote.costItemName,
            payType: remote.payType,
            nearestJob: "", // JobTread doesn't hold the clock-in GPS fix
            employee: remote.employee,
            resumed: true,
          };
          setActiveClock(resumedClock);
          saveClock(resumedClock);
          setClockNote("Picked up from JobTread — you were already clocked in.");
          return;
        }

        // JobTread has no running clock. Only clear a local one that JobTread
        // could actually have seen: a preview clock (writes off) has no entry
        // id and lives here alone, and an unlinked login means we never looked.
        if (local && local.entryId && j.linked) {
          try {
            localStorage.removeItem(LS_CLOCK);
          } catch {}
          setActiveClock(null);
          setClockNote("That clock-in is already closed in JobTread — starting fresh.");
        }
      })
      .catch(() => {
        /* offline: the localStorage record stands */
      })
      .finally(() => setClockChecked(true));
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

  // Open a sheet, optionally remembering the one it covered.
  function openSheet(id: SheetId, from: SheetId = null) {
    setReturnSheet(from);
    setSheet(id);
  }
  // Close the open sheet, reopening whatever it covered.
  function closeSheet() {
    setSheet(returnSheet);
    setReturnSheet(null);
  }

  function pickUser(id: string) {
    setPickedUserId(id);
    setPayType("");
    closeSheet();
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
          setGeoNote(`Nearest job — you're at ${near.s.label}`);
        } else {
          setGeoNote("No job site nearby — pick the job.");
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
  // org-wide list as a fallback. Auto-set when there's exactly one option; the
  // row only offers a choice when there are several.
  const perMemberTypes = effectiveUser?.types;
  const payTypes: PayType[] = useMemo(
    () => perMemberTypes ?? orgTypes.map((name) => ({ name })),
    [perMemberTypes, orgTypes],
  );
  const typesAreFallback = !perMemberTypes && orgTypes.length > 0;
  useEffect(() => {
    if (payType) return;
    if (payTypes.length === 1) setPayType(payTypes[0].name);
  }, [payTypes, payType]);

  // The selected job — from the fetched list, falling back to the GPS site
  // label for a job that isn't in the (open-jobs) list.
  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobId) ?? null, [jobs, jobId]);
  const jobLabelText = selectedJob ? jobRefLabel(selectedJob) : nearestJob;
  const selectedCost = costItems.find((c) => c.id === costItemId) ?? null;
  const costLabelText = selectedCost
    ? `${selectedCost.number}${selectedCost.name ? ` — ${selectedCost.name}` : ""}`
    : "";
  const duration = fmtDuration(startTime, endTime);

  // The idle start-time chips follow the wall clock until they're edited.
  useEffect(() => {
    if (activeClock || startTouched) return;
    const id = setInterval(() => setStartAt(nowLocal()), 20000);
    return () => clearInterval(id);
  }, [activeClock, startTouched]);

  // Elapsed time since clock-in, ticking every second while active.
  useEffect(() => {
    if (!activeClock) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeClock]);
  const elapsed = activeClock
    ? fmtElapsed(nowMs - new Date(activeClock.startedAt).getTime())
    : "0:00:00";

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

  function resetStart() {
    setStartAt(nowLocal());
    setStartTouched(false);
  }

  // ------------------------------------------------------------- Clock in/out
  async function clockIn() {
    setErr("");
    if (!effectiveUserId) {
      setErr("Pick who you are in JobTread first.");
      openSheet("user");
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
    // An edited start time is used as typed (to the minute); an untouched one is
    // "right now", to the second — JobTread rejects end <= start, so a same-
    // minute clock-in/out needs the seconds.
    const startedAt = startTouched ? `${startAt}:00` : nowLocalSeconds();
    if (new Date(startedAt).getTime() > Date.now() + 60000) {
      setErr("That start time is in the future.");
      return;
    }
    setBusy(true);
    try {
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
        jobLabel: jobLabelText,
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
      setClockNote("");
      saveClock(clock);
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
      setSheet(null);
      setClockNote("");
      setNote("");
      setPhotos([]);
      resetStart();
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
    setSheet(null);
    setClockNote("");
    setErr("");
    resetStart();
    setBusy(false);
  }

  // ---------------------------------------------------------- Log a range
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
          jobLabel: jobLabelText,
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
      setSheet(null);
      setDone({
        result: json,
        summary: {
          jobLabel: jobLabelText,
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
    jobLabelText,
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
    resetStart();
  }

  // --------------------------------------------------------------- Timesheets
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
    if (tab === "sheets") loadHistory();
  }, [tab, loadHistory]);

  // The period's entries as day groups — newest day first, the API's own order.
  const dayGroups: DayGroup[] = useMemo(() => {
    const shown = openOnly ? historyEntries.filter((e) => e.open) : historyEntries;
    const byDay = new Map<string, HistoryEntry[]>();
    for (const e of shown) {
      const list = byDay.get(e.date);
      if (list) list.push(e);
      else byDay.set(e.date, [e]);
    }
    return [...byDay.entries()].map(([date, entries]) => ({
      date,
      entries,
      minutes: entries.reduce((s, e) => s + e.minutes, 0),
      approved: entries.every((e) => e.approved),
      anyOpen: entries.some((e) => e.open),
    }));
  }, [historyEntries, openOnly]);

  // Wait for the JobTread resume check too, so a running clock never renders as
  // the "Clock in" form for a beat — that flash is a mis-tap waiting to happen.
  if (loading || !clockChecked) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title={EMPLOYEE_TIME_TITLE} description="Clock in and out of a job." />
        <Loading label="Loading…" />
      </main>
    );
  }

  // ---------------------------------------------------------------- DONE ------
  if (done) {
    const dur = fmtDuration(done.summary.startTime, done.summary.endTime);
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title={EMPLOYEE_TIME_TITLE} description="Clock in and out of a job." />
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
            className="w-full rounded-full bg-accent px-4 py-5 text-base font-bold text-accent-fg shadow-sm transition hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      </main>
    );
  }

  const needsUserPick = !!me && !me.jtUserId;
  const running = !!activeClock;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-4">
      <PageHeader
        title={EMPLOYEE_TIME_TITLE}
        description="Clock in and out of a job, and check your timesheet."
      />

      {/* Time clock | Timesheets — the app's two halves, one tap apart. */}
      <Segmented
        value={tab}
        onChange={(v) => setTab(v as "clock" | "sheets")}
        options={[
          { value: "clock", label: "Time clock" },
          { value: "sheets", label: "Timesheets" },
        ]}
      />

      {/* Who + PTO/sick, on one thin line so the clock screen stays clean. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span className="truncate">
          {effectiveName ? (
            <>
              <span className="font-semibold text-neutral-700 dark:text-neutral-200">{effectiveName}</span>
              {leaveBal.length > 0 &&
                (["sick", "pto"] as const).map((t) => {
                  const b = leaveBal.find((x) => x.leaveType === t);
                  return b ? (
                    <span key={t} className="ml-3 tabular-nums">
                      {t === "sick" ? "Sick" : "PTO"} {fmtHM(b.balance)}
                    </span>
                  ) : null;
                })}
            </>
          ) : (
            "Time off"
          )}
        </span>
        <Link href="/time-off" className="shrink-0 font-semibold text-accent hover:underline dark:text-accent-soft">
          Time off →
        </Link>
      </div>

      {err && (
        <Banner tone="error" className="mb-3">
          {err}
        </Banner>
      )}

      {/* We couldn't match the login to a JobTread user — one tap fixes it. */}
      {needsUserPick && (
        <button
          type="button"
          onClick={() => openSheet("user")}
          className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-left text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <span>
            {effectiveUser
              ? `Logging as ${effectiveUser.name} — tap to change.`
              : "Tap to pick who you are in JobTread."}
          </span>
          <span aria-hidden>›</span>
        </button>
      )}

      {/* ========================================================= TIME CLOCK */}
      {tab === "clock" && (
        <>
          {clockNote && (
            <p className="mb-3 rounded-xl bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
              {clockNote}
            </p>
          )}

          {/* The state, big — the one thing a crew member checks at a glance. */}
          <div className="pb-4 pt-2 text-center">
            <h2 className="text-2xl font-bold">{running ? "Clocked in" : "Clocked out"}</h2>
            {running && (
              <>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden />
                  <span className="text-4xl font-bold tabular-nums">{elapsed}</span>
                </div>
                {activeClock?.previewed && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    JobTread push is OFF — this clock is local-only until writes are enabled.
                  </p>
                )}
              </>
            )}
          </div>

          <Card pad={false} className="overflow-hidden">
            {running && activeClock ? (
              <>
                <FieldRow label="Started" value={displayStamp(activeClock.startedAt)} static />
                <FieldRow label="Job" value={activeClock.jobLabel || "—"} static />
                <FieldRow
                  label="Cost code"
                  value={[activeClock.costCode, activeClock.costItemName].filter(Boolean).join(" — ") || "—"}
                  static
                />
                {activeClock.payType && <FieldRow label="Pay type" value={activeClock.payType} static />}
                <FieldRow
                  label="Note"
                  value={note.trim() || "Add a note"}
                  placeholder={!note.trim()}
                  sub={note.trim() ? undefined : "Required to clock out"}
                  onClick={() => openSheet("note")}
                />
              </>
            ) : (
              <>
                {/* Start time — "now" unless you say otherwise. */}
                <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-line-soft px-3 py-2.5">
                  <span className="text-[13px] text-neutral-500">Start time</span>
                  <span className="flex items-center gap-2">
                    <ChipInput
                      type="date"
                      value={startAt.slice(0, 10)}
                      display={dayChipLabel(startAt.slice(0, 10))}
                      ariaLabel="Start date"
                      onChange={(v) => {
                        if (!v) return;
                        setStartTouched(true);
                        setStartAt(`${v}T${startAt.slice(11, 16)}`);
                      }}
                    />
                    <ChipInput
                      type="time"
                      value={startAt.slice(11, 16)}
                      display={fmt12h(startAt.slice(11, 16))}
                      ariaLabel="Start time"
                      onChange={(v) => {
                        if (!v) return;
                        setStartTouched(true);
                        setStartAt(`${startAt.slice(0, 10)}T${v.slice(0, 5)}`);
                      }}
                    />
                  </span>
                </div>

                <FieldRow
                  label="Job"
                  value={jobLabelText || "Select a job"}
                  placeholder={!jobLabelText}
                  sub={selectedJob ? jobAddress(selectedJob) || undefined : geoNote || undefined}
                  onClick={() => openSheet("job")}
                  onClear={jobId ? () => setJobId("") : undefined}
                />

                <FieldRow
                  label="Cost code"
                  value={
                    costLabelText ||
                    (!jobId
                      ? "Pick a job first"
                      : loadingCosts
                        ? "Loading cost codes…"
                        : costItems.length
                          ? "Select a cost code"
                          : "No cost codes on this job")
                  }
                  placeholder={!costLabelText}
                  onClick={jobId && costItems.length ? () => openSheet("cost") : undefined}
                />

                {payTypes.length > 1 && (
                  <FieldRow
                    label="Pay type"
                    value={payType || "Select a pay type"}
                    placeholder={!payType}
                    sub={typesAreFallback ? "All pay types — pick your rate for this job" : undefined}
                    onClick={() => openSheet("type")}
                  />
                )}

                <FieldRow
                  label="Note"
                  value={note.trim() || "Add a note"}
                  placeholder={!note.trim()}
                  sub={note.trim() ? undefined : "Required when you clock out"}
                  onClick={() => openSheet("note")}
                />
              </>
            )}
          </Card>

          {running && (
            <button
              type="button"
              onClick={cancelClockIn}
              disabled={busy}
              className="mx-auto mt-4 block text-xs text-neutral-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40"
            >
              Cancel this clock-in
            </button>
          )}

          {/* The one big action, docked above the tab bar, plus "log a range". */}
          <Dock>
            <button
              type="button"
              onClick={running ? () => openSheet("out") : clockIn}
              disabled={busy}
              className={`min-w-[220px] rounded-full px-10 py-4 text-lg font-bold shadow-lg transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                running
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-accent text-accent-fg hover:bg-accent-hover"
              }`}
            >
              {busy ? "Working…" : running ? "Clock out" : "Clock in"}
            </button>
            <button
              type="button"
              aria-label="Log a range of time"
              title="Log a range"
              onClick={() => {
                setErr("");
                setStartTime(nowLocal());
                setEndTime(nowLocal());
                openSheet("manual");
              }}
              className="absolute right-0 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-white text-2xl font-bold text-accent shadow-lg transition active:scale-95 dark:bg-ink-raised dark:text-accent-soft"
            >
              +
            </button>
          </Dock>
        </>
      )}

      {/* ========================================================= TIMESHEETS */}
      {tab === "sheets" && (
        <div className="space-y-3">
          {/* Pay period: month arrows, then the two halves + an open filter. */}
          <div className="flex items-center justify-between gap-2">
            <IconButton label="Previous month" onClick={() => setHistoryMonth((m) => shiftMonth(m, -1))}>
              ‹
            </IconButton>
            <span className="text-sm font-bold">{monthLabel(historyMonth)}</span>
            <IconButton label="Next month" onClick={() => setHistoryMonth((m) => shiftMonth(m, 1))}>
              ›
            </IconButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <PillTab active={historyHalf === "a"} onClick={() => setHistoryHalf("a")}>
              1–15
            </PillTab>
            <PillTab active={historyHalf === "b"} onClick={() => setHistoryHalf("b")}>
              16–end
            </PillTab>
            <PillTab active={openOnly} onClick={() => setOpenOnly((v) => !v)} className="ml-auto">
              Still clocked in{historyOpenCount ? ` (${historyOpenCount})` : ""}
            </PillTab>
          </div>

          <Card className="flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Period total
            </span>
            <span className="text-2xl font-bold tabular-nums">{fmtMinutes(historyTotalMin) || "0m"}</span>
          </Card>

          {historyErr && <Banner tone="error">{historyErr}</Banner>}

          {historyLoading ? (
            <Loading label="Loading your time…" />
          ) : dayGroups.length === 0 ? (
            <EmptyState>
              {openOnly ? "Nothing is running right now." : "No time logged for this period."}
            </EmptyState>
          ) : (
            dayGroups.map((g) => <DaySection key={g.date} group={g} />)
          )}
        </div>
      )}

      {/* ============================================================= SHEETS */}

      {/* Who you are in JobTread. */}
      <Sheet open={sheet === "user"} title="Who are you in JobTread?" onClose={closeSheet}>
        <p className="pb-2 text-xs text-neutral-500">
          Pick yourself once — it&apos;s remembered on this device. (An admin can link you on the
          Employees page to skip this.)
        </p>
        <ul className="pb-2">
          {jtUsers.map((u) => (
            <OptionRow
              key={u.id}
              selected={u.id === effectiveUserId}
              label={(u.isInternal ? "★ " : "") + u.name}
              onClick={() => pickUser(u.id)}
            />
          ))}
        </ul>
      </Sheet>

      {/* Job. */}
      <JobSheet
        open={sheet === "job"}
        jobs={jobs}
        selectedId={jobId}
        onPick={(j) => {
          setJobId(j.id);
          setNearestJob("");
          closeSheet();
        }}
        onClose={closeSheet}
      />

      {/* Cost code. */}
      <CostSheet
        open={sheet === "cost"}
        items={costItems}
        selectedId={costItemId}
        onPick={(c) => {
          setCostItemId(c.id);
          closeSheet();
        }}
        onClose={closeSheet}
      />

      {/* Pay type. */}
      <Sheet open={sheet === "type"} title="Pay type" onClose={closeSheet}>
        <ul className="pb-2">
          {payTypes.map((t) => (
            <OptionRow
              key={t.name}
              selected={t.name === payType}
              label={t.name}
              sub={typeof t.hourlyRate === "number" ? `$${t.hourlyRate}/hr` : undefined}
              onClick={() => {
                setPayType(t.name);
                closeSheet();
              }}
            />
          ))}
        </ul>
      </Sheet>

      {/* Note (written before clocking in, or while on the clock). */}
      <Sheet
        open={sheet === "note"}
        title="Note"
        onClose={closeSheet}
        footer={
          <button
            type="button"
            onClick={closeSheet}
            className="w-full rounded-full bg-accent px-4 py-3.5 text-base font-bold text-accent-fg transition hover:bg-accent-hover"
          >
            Save note
          </button>
        }
      >
        <Textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you work on?"
        />
        <p className="mt-2 text-xs text-neutral-500">JobTread requires a note on every time entry.</p>
      </Sheet>

      {/* Clock out — the note is required, photos are optional. */}
      <Sheet
        open={sheet === "out"}
        title="Clock out"
        onClose={closeSheet}
        footer={
          <button
            type="button"
            onClick={confirmClockOut}
            disabled={busy}
            className="w-full rounded-full bg-red-600 px-4 py-3.5 text-base font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : `Clock out — ${elapsed}`}
          </button>
        }
      >
        {activeClock && (
          <p className="pb-3 text-sm text-neutral-500">
            {activeClock.jobLabel}
            {activeClock.costCode ? ` · ${activeClock.costCode}` : ""}
          </p>
        )}
        {err && (
          <Banner tone="error" className="mb-3">
            {err}
          </Banner>
        )}
        <Label htmlFor="et-clockout-note">Note (required)</Label>
        <Textarea
          id="et-clockout-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you work on?"
        />
        <div className="mt-4">
          <PhotoPicker photos={photos} onAdd={addPhotos} onRemove={removePhoto} />
        </div>
      </Sheet>

      {/* Log a range — time already worked, entered in one shot. */}
      <Sheet
        open={sheet === "manual"}
        title="Log a range"
        tall
        onClose={() => {
          setSheet(null);
          setReturnSheet(null);
        }}
        footer={
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-full bg-accent px-4 py-3.5 text-base font-bold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Log time"}
          </button>
        }
      >
        {err && (
          <Banner tone="error" className="mb-3">
            {err}
          </Banner>
        )}
        <Card pad={false} className="overflow-hidden">
          <FieldRow
            label="Job"
            value={jobLabelText || "Select a job"}
            placeholder={!jobLabelText}
            sub={selectedJob ? jobAddress(selectedJob) || undefined : undefined}
            onClick={() => openSheet("job", "manual")}
            onClear={jobId ? () => setJobId("") : undefined}
          />
          <FieldRow
            label="Cost code"
            value={
              costLabelText ||
              (!jobId
                ? "Pick a job first"
                : loadingCosts
                  ? "Loading cost codes…"
                  : costItems.length
                    ? "Select a cost code"
                    : "No cost codes on this job")
            }
            placeholder={!costLabelText}
            onClick={jobId && costItems.length ? () => openSheet("cost", "manual") : undefined}
          />
          {payTypes.length > 1 && (
            <FieldRow
              label="Pay type"
              value={payType || "Select a pay type"}
              placeholder={!payType}
              onClick={() => openSheet("type", "manual")}
            />
          )}
        </Card>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        {duration && <p className="mt-1 text-xs text-neutral-500">{duration}</p>}

        <div className="mt-3">
          <Label htmlFor="et-note">Note (required)</Label>
          <Textarea
            id="et-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you work on?"
          />
        </div>

        <div className="mt-4 pb-2">
          <PhotoPicker photos={photos} onAdd={addPhotos} onRemove={removePhoto} />
        </div>
      </Sheet>
    </main>
  );
}

/* ------------------------------------------------------------------ pieces */

/** iOS-style two-up segmented control — the app's top-level Time clock/Timesheets switch. */
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div
      role="tablist"
      className="mb-3 flex rounded-full bg-neutral-200/80 p-1 dark:bg-white/10"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`min-h-11 flex-1 rounded-full text-sm font-bold transition ${
              active
                ? "bg-white text-neutral-900 shadow-sm dark:bg-ink-raised dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A pay-period / filter pill (the timesheet's own filter chips). */
function PillTab({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-[13px] font-semibold transition ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line bg-white text-neutral-500 hover:border-accent dark:bg-ink-raised dark:text-neutral-400"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * One tap-through row of the clock form: its label above the value, a clear
 * button when there's something to clear, and a chevron when it opens a sheet.
 * `static` renders the same row as read-only (the clocked-in context).
 */
function FieldRow({
  label,
  value,
  sub,
  placeholder = false,
  onClick,
  onClear,
  static: isStatic = false,
}: {
  label: string;
  value: string;
  sub?: string;
  placeholder?: boolean;
  onClick?: () => void;
  onClear?: () => void;
  static?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-neutral-500">{label}</span>
        <span
          className={`block truncate text-[15px] ${
            placeholder ? "text-neutral-400" : "font-semibold"
          }`}
        >
          {value}
        </span>
        {sub && <span className="block truncate text-xs text-neutral-400">{sub}</span>}
      </span>
      {!isStatic && (
        <span aria-hidden className="shrink-0 text-neutral-400">
          ›
        </span>
      )}
    </>
  );

  if (isStatic || !onClick) {
    return (
      <div className="flex min-h-[56px] items-center gap-2 border-b border-line-soft px-3 py-2.5 last:border-b-0">
        {body}
      </div>
    );
  }

  return (
    <div className="flex min-h-[56px] items-center border-b border-line-soft last:border-b-0">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left transition active:bg-accent/10"
      >
        {body}
      </button>
      {onClear && (
        <IconButton label={`Clear ${label.toLowerCase()}`} onClick={onClear} className="mr-1">
          <span aria-hidden className="text-lg">
            ⊗
          </span>
        </IconButton>
      )}
    </div>
  );
}

/**
 * A date/time value shown as a tappable chip. The native picker is the input
 * itself, laid transparently over the chip — that's what keeps the phone's own
 * date/time wheel while the face reads "Today · 1:23 pm" instead of a browser's
 * default field.
 */
function ChipInput({
  type,
  value,
  display,
  ariaLabel,
  onChange,
}: {
  type: "date" | "time";
  value: string;
  display: string;
  ariaLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="relative inline-flex min-h-11 items-center rounded-xl bg-neutral-200/80 px-3.5 text-sm font-semibold dark:bg-white/10">
      {display}
      <input
        type={type}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/** A bottom sheet — the app's picker/confirm surface, dismissed by tap or Esc. */
function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  tall = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tall?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        className={`relative flex flex-col rounded-t-3xl border-t border-line bg-cream shadow-2xl dark:bg-ink-overlay ${
          tall ? "max-h-[92vh]" : "max-h-[85vh]"
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <span className="text-base font-bold">{title}</span>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden className="text-lg">
              ✕
            </span>
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <div
            className="border-t border-line px-4 pt-3"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** One selectable row inside a sheet. */
function OptionRow({
  selected,
  label,
  sub,
  onClick,
}: {
  selected: boolean;
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[52px] w-full items-center gap-3 border-b border-line-soft px-1 py-2.5 text-left last:border-b-0"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${selected ? "font-bold text-accent dark:text-accent-soft" : ""}`}>
            {label}
          </span>
          {sub && <span className="block truncate text-xs text-neutral-500">{sub}</span>}
        </span>
        {selected && (
          <span aria-hidden className="shrink-0 text-accent dark:text-accent-soft">
            ✓
          </span>
        )}
      </button>
    </li>
  );
}

/** The job picker sheet — searchable, because the org has a lot of jobs. */
function JobSheet({
  open,
  jobs,
  selectedId,
  onPick,
  onClose,
}: {
  open: boolean;
  jobs: JobRef[];
  selectedId: string;
  onPick: (j: JobRef) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const query = q.trim().toLowerCase();
  const shown = query
    ? jobs.filter((j) =>
        `${j.customer ?? ""} ${j.number ?? ""} ${j.name} ${j.address ?? ""}`.toLowerCase().includes(query),
      )
    : jobs;
  return (
    <Sheet open={open} title="Job" onClose={onClose} tall>
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search jobs…"
        className="mb-2"
      />
      <ul className="pb-2">
        {shown.map((j) => (
          <OptionRow
            key={j.id}
            selected={j.id === selectedId}
            label={jobRefLabel(j)}
            sub={jobAddress(j) || undefined}
            onClick={() => onPick(j)}
          />
        ))}
        {shown.length === 0 && (
          <li className="px-1 py-4 text-sm text-neutral-500">
            {jobs.length ? "No matching job." : "Loading jobs…"}
          </li>
        )}
      </ul>
    </Sheet>
  );
}

/** The cost-code sheet — the picked job's budget cost items, searchable. */
function CostSheet({
  open,
  items,
  selectedId,
  onPick,
  onClose,
}: {
  open: boolean;
  items: CostItem[];
  selectedId: string;
  onPick: (c: CostItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const query = q.trim().toLowerCase();
  const shown = query
    ? items.filter((c) => `${c.number} ${c.name}`.toLowerCase().includes(query))
    : items;
  return (
    <Sheet open={open} title="Cost code" onClose={onClose} tall>
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search cost codes…"
        className="mb-2"
      />
      <ul className="pb-2">
        {shown.map((c) => (
          <OptionRow
            key={c.id}
            selected={c.id === selectedId}
            label={c.number}
            sub={c.name || undefined}
            onClick={() => onPick(c)}
          />
        ))}
        {shown.length === 0 && <li className="px-1 py-4 text-sm text-neutral-500">No matching cost code.</li>}
      </ul>
    </Sheet>
  );
}

/**
 * The docked action strip: one big pill centred above the tab bar, with the
 * "log a range" button parked at the right. Offset by --tabbar-h (globals.css)
 * so the two bars can never overlap.
 */
function Dock({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 z-20 px-4 print:hidden"
      style={{ bottom: "calc(var(--tabbar-h, 0px) + 0.75rem)" }}
    >
      <div className="relative mx-auto flex max-w-2xl items-center justify-center">{children}</div>
    </div>
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
            className="relative h-20 w-20 overflow-hidden rounded-lg border border-line"
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

/** One day of the timesheet: the heading (date · state · total) and its rows. */
function DaySection({ group }: { group: DayGroup }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5 pt-3">
        <h3 className="text-sm font-bold">
          {dayHeading(group.date)}
          {group.anyOpen ? (
            <span className="ml-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
              · Clocked in
            </span>
          ) : group.approved ? (
            <span className="ml-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              · Approved
            </span>
          ) : (
            <span className="ml-2 text-sm font-semibold text-neutral-400">· Pending</span>
          )}
        </h3>
        <span className="shrink-0 text-sm font-bold tabular-nums">{fmtMinutes(group.minutes) || "0m"}</span>
      </div>
      <Card pad={false} className="overflow-hidden">
        {group.entries.map((e) => (
          <EntryRow key={e.id} e={e} />
        ))}
      </Card>
    </section>
  );
}

function EntryRow({ e }: { e: HistoryEntry }) {
  return (
    <JtLink
      href={e.jtUrl}
      className="flex items-start justify-between gap-3 border-b border-line-soft px-3 py-3 last:border-b-0"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{e.jobName || "—"}</span>
        {(e.customer || e.costCode) && (
          <span className="block truncate text-xs text-neutral-500">
            {[e.customer, [e.costCode, e.costItemName].filter(Boolean).join(" — ")]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {e.notes && <span className="block truncate text-xs text-neutral-400">{e.notes}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[15px] font-bold tabular-nums">
          {e.open ? "running" : fmtMinutes(e.minutes) || "0m"}
        </span>
        <span className="block text-xs text-neutral-500 tabular-nums">
          {fmt12h(e.startTime)} – {e.endTime ? fmt12h(e.endTime) : "…"}
        </span>
      </span>
    </JtLink>
  );
}
