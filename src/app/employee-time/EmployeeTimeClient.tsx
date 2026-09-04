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
  Select,
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
 *    sets its endedAt + the required note (updateTimeEntry). The Clock out
 *    sheet can also CORRECT the start time — "I started at 7, I clocked in at
 *    9" — and only a corrected one is written back. The running clock
 *    is resumed FROM JOBTREAD on load (GET /api/employee-time/clock returns the
 *    open entry), so opening the page anywhere — a new phone, a cleared
 *    browser, the office desktop — shows Clock out with the real start time and
 *    job/cost code. It's also mirrored to localStorage (like /mileage-tracker's
 *    start/end trip) as the offline fallback and to carry the one thing
 *    JobTread doesn't hold (the log's idempotency key); JobTread wins on any
 *    disagreement.
 *  - TIMESHEETS: the signed-in employee's own JobTread entries for a bi-monthly
 *    pay period (1st–15th / 16th–end), grouped by day with the day's total and
 *    its JobTread approval state, each row linking to JobTread.
 *  - The "+" beside the docked pill opens "Log a range" — the one-shot form for
 *    time already worked (job + cost code + start/stop + note + photos).
 *
 * The signed-in user is resolved to their linked JobTread user (via the
 * Employee roster) and times default to now. Every write is gated by
 * COMPANION_WRITES_ENABLED (default preview); the Time Entries sheet record +
 * photos are saved either way.
 *
 * There is NO location capture here: the nearest-job GPS pre-fill was removed
 * 2026-08-26 (unused, and it cost a permission prompt plus a fix on every load).
 */

interface Me {
  name: string;
  email: string;
  jtUserId: string;
  jtUserName: string;
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
  /** The server took the entry and is finishing it in the background — see the
   *  "detached" note in api/employee-time/route.ts. The push outcome is no
   *  longer known in this same second, and deliberately so. */
  accepted?: boolean;
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
  costItemId: string;
  costCode: string;
  costItemName: string;
  payType: string;
  notes: string;
  approved: boolean;
  open: boolean;
  jtUrl: string;
}
/** The bottom sheets this page can show; null = none open. */
type SheetId =
  | "job"
  | "cost"
  | "type"
  | "note"
  | "out"
  | "manual"
  | "user"
  | "edit"
  | "editjob"
  | "editcost"
  | null;

/** One day of the timesheet: its entries, its total, and its approval state. */
interface DayGroup {
  date: string;
  entries: HistoryEntry[];
  minutes: number;
  approved: boolean;
  anyOpen: boolean;
}

const MAX_PHOTOS = 8;
const LS_JT_USER = "employeeTime.jtUser."; // + email → remembered JobTread user id
const LS_CLOCK = "employeeTime.activeClock";
const LS_LAST_PICK = "employeeTime.lastPick."; // + email → last job/cost/pay used

// The last job, cost code and pay type this person logged ON THIS DEVICE. It is
// the first default; JobTread's own last entry (the `lastUsed` prop) is the
// fallback that follows a person to a new phone.
function readLastPick(email: string | undefined): LastUsed | null {
  if (!email) return null;
  try {
    const raw = localStorage.getItem(LS_LAST_PICK + email);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastUsed>;
    return p?.jobId
      ? {
          jobId: p.jobId,
          costItemId: p.costItemId ?? "",
          costCode: p.costCode ?? "",
          payType: p.payType ?? "",
        }
      : null;
  } catch {
    return null;
  }
}

function saveLastPick(email: string | undefined, pick: LastUsed) {
  if (!email || !pick.jobId) return;
  try {
    localStorage.setItem(LS_LAST_PICK + email, JSON.stringify(pick));
  } catch {}
}

// A fresh idempotency key for one logical time entry. The same key rides every
// retry of that entry (bad service drops the response, not the server's work),
// so the backend reconciles a retry to the same row instead of duplicating it.
const newLogKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? `te-${crypto.randomUUID()}`
    : `te-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The job/cost/pay a person used last, read off their newest JobTread entry. */
interface LastUsed {
  jobId: string;
  costItemId: string;
  costCode: string;
  payType: string;
}

// JobTread's open entry → the page's clock record. `resumed` marks a clock this
// device never started (a new phone, or the office computer). The log key is
// DERIVED FROM THE ENTRY ID, not random, so two devices clocking out of the
// same entry write ONE Time Entries row.
function clockFromOpenEntry(e: OpenEntry, resumed: boolean): ActiveClock {
  return {
    entryId: e.entryId,
    logKey: `te-jt-${e.entryId}`,
    previewed: false, // it exists in JobTread by definition
    jtStatus: "pushed",
    startedAt: e.startedAt,
    jobId: e.jobId,
    jobLabel: e.jobLabel,
    costItemId: e.costItemId,
    costCode: e.costCode,
    costItemName: e.costItemName,
    payType: e.payType,
    employee: e.employee,
    resumed,
  };
}

// Mirror the running clock to this device. Not the source of truth (JobTread is
// — see the resume effect), but it keeps the clock alive offline and holds the
// one thing JobTread never sees: the log's idempotency key.
function saveClock(c: ActiveClock) {
  try {
    localStorage.setItem(LS_CLOCK, JSON.stringify(c));
  } catch {}
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

// The months the timesheet's month picker offers: this month back through two
// years, newest first. The arrows can step outside that window, so the month in
// hand is always in the list — a select cannot show a value it has no option for.
const MONTH_CHOICE_COUNT = 24;
function monthChoices(selected: string): string[] {
  const now = defaultMonth();
  const list: string[] = [];
  for (let i = 0; i < MONTH_CHOICE_COUNT; i++) list.push(shiftMonth(now, -i));
  if (selected && !list.includes(selected)) {
    list.push(selected);
    list.sort().reverse();
  }
  return list;
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

export function EmployeeTimeClient({
  initialJobs,
  initialMe,
  initialJtUsers,
  initialOrgTypes,
  initialOpenEntry,
  initialLinked,
  identityResolved,
  lastUsed,
}: {
  initialJobs: JobRef[];
  initialMe: Me | null;
  initialJtUsers: UserRef[];
  initialOrgTypes: string[];
  initialOpenEntry: OpenEntry | null;
  initialLinked: boolean;
  identityResolved: boolean;
  lastUsed: LastUsed | null;
}) {
  const [tab, setTab] = useState<"clock" | "sheets">("clock");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reference data — all of it preloaded by the server shell (page.tsx), so the
  // screen paints complete. The fetches below are the COLD path only: they run
  // when the shell could not resolve who you are (first sign-in, expired link).
  const [me, setMe] = useState<Me | null>(initialMe);
  const [jtUsers, setJtUsers] = useState<UserRef[]>(initialJtUsers);
  const [orgTypes, setOrgTypes] = useState<string[]>(initialOrgTypes);
  const [jobs, setJobs] = useState<JobRef[]>(initialJobs);
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

  // Clock in/out. The server shell already asked JobTread, so a running clock is
  // on screen in the first paint — there is no "checking…" gate to sit through.
  const [activeClock, setActiveClock] = useState<ActiveClock | null>(
    initialOpenEntry ? clockFromOpenEntry(initialOpenEntry, false) : null,
  );
  const [nowMs, setNowMs] = useState(0);
  const [clockNote, setClockNote] = useState("");
  // True only while the COLD path is still asking who you are. The clock button
  // stays off until it answers, so a mis-tap cannot start a second entry.
  const [resolving, setResolving] = useState(!identityResolved);
  // The end time used when clocking out. It follows the wall clock until you
  // change it — that is the "we forgot to clock out at 3" case.
  const [endAt, setEndAt] = useState(nowLocal());
  const [endTouched, setEndTouched] = useState(false);
  // The START time, correctable on the way out — the "I actually started at 7,
  // I only clocked in at 9" case. Seeded from the running clock every time the
  // Clock out sheet opens; an untouched value is never written back.
  const [outStartAt, setOutStartAt] = useState(nowLocal());
  const [outStartTouched, setOutStartTouched] = useState(false);

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

  // --- Editing an existing timesheet entry -----------------------------------
  // Tapping a (closed) row in the Timesheets tab opens the same editor the rest
  // of the page uses — job / cost code / start / stop / note — pre-filled with
  // that entry, and saves an updateTimeEntry in place. Its own state, kept apart
  // from the clock/Log-a-range fields so opening an edit never disturbs a clock
  // that's mid-setup on the other tab.
  const [editEntry, setEditEntry] = useState<HistoryEntry | null>(null);
  const [editJobId, setEditJobId] = useState("");
  const [editCostItems, setEditCostItems] = useState<CostItem[]>([]);
  const [editLoadingCosts, setEditLoadingCosts] = useState(false);
  const [editCostItemId, setEditCostItemId] = useState("");
  const [editStart, setEditStart] = useState(""); // "YYYY-MM-DDTHH:MM"
  const [editEnd, setEditEnd] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [editMsg, setEditMsg] = useState(""); // e.g. the writes-off preview notice
  // The cost code the entry already sits on is re-selected once the picked job's
  // cost items land — but only on the entry's original job, and only while the
  // user hasn't changed the pick themselves.
  const editWantCostRef = useRef<{ jobId: string; costItemId: string } | null>(null);

  // --- Mount: reconcile the local clock, then fill any gap the shell left. ---
  //
  // The server shell already carries the identity, the reference data, the jobs
  // and JobTread's answer on the running clock, so there is nothing to wait for
  // in the normal case. This effect does three things:
  //   1. merges the phone's own record of the clock with JobTread's,
  //   2. runs the COLD path when the shell could not resolve who you are,
  //   3. loads the leave balances (a separate, slower system — never blocking).
  useEffect(() => {
    // The phone's mirror. It is the only record when writes are off or the
    // network is down, and it holds the log's idempotency key.
    let local: ActiveClock | null = null;
    try {
      const raw = localStorage.getItem(LS_CLOCK);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.startedAt && c.jobId && c.costItemId) {
          if (!c.logKey) c.logKey = newLogKey(); // clock-in from before this key existed
          local = c as ActiveClock;
        }
      }
    } catch {}

    // JobTread is the source of truth for "am I on the clock" — an OPEN entry
    // (no endedAt) IS the running clock — so a clock resumes on ANY device.
    // Deliberately does NOT touch jobId/costItemId/payType: the clocked-in
    // context is rendered read-only from the resolved record itself.
    function reconcile(remote: OpenEntry | null, linked: boolean) {
      if (remote) {
        if (local && local.entryId === remote.entryId) {
          // Same clock, seen from the device that started it. Keep what only
          // this device knows (the log's idempotency key), but let JobTread's
          // copy win on everything it owns — it reflects any edit the office
          // made to the entry since clock-in.
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
        const resumed = clockFromOpenEntry(remote, true);
        setActiveClock(resumed);
        saveClock(resumed);
        setClockNote("Picked up from JobTread — you were already clocked in.");
        return;
      }

      // JobTread has no running clock. Only clear a local one that JobTread
      // could actually have seen: a preview clock (writes off) has no entry id
      // and lives here alone, and an unresolved identity means we never looked.
      if (local && local.entryId && linked) {
        try {
          localStorage.removeItem(LS_CLOCK);
        } catch {}
        setActiveClock(null);
        setClockNote("That clock-in is already closed in JobTread — starting fresh.");
      } else if (local) {
        setActiveClock(local);
      }
    }

    if (identityResolved) {
      reconcile(initialOpenEntry, initialLinked);
    } else {
      // COLD path: the roster link was not cached, so the shell could not name
      // you. Show the screen anyway (the local clock stands) and resolve in the
      // background — /api/employee-time writes the link, so this happens once.
      if (local) setActiveClock(local);
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
        })
        .catch(() => setErr("Couldn't reach the server."));

      fetch("/api/employee-time/clock")
        .then((r) => r.json())
        .then((j: { ok?: boolean; linked?: boolean; openEntry?: OpenEntry | null }) => {
          if (j.ok === false) return; // can't tell — leave the local record alone
          reconcile(j.openEntry ?? null, !!j.linked);
        })
        .catch(() => {
          /* offline: the localStorage record stands */
        })
        .finally(() => setResolving(false));
    }

    // Fallback only: the server preload covers the normal case, so this fires
    // just when it failed or the grant was missing at render time.
    if (!initialJobs.length) {
      fetch("/api/jobs")
        .then((r) => r.json())
        .then((j) => setJobs(j.jobs ?? []))
        .catch(() => {});
    }

    // Own PTO/sick balances for the summary strip (own-balance view).
    fetch("/api/time-off/me")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok !== false) setLeaveBal(j.balances ?? []);
      })
      .catch(() => {});
    // Mount-only: every prop above is a render-time constant from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Start on what you used last: this device's remembered pick first, else the
  // job/cost/pay of your newest JobTread entry (which the shell read for us). A
  // crew member on the same job all week taps Clock in and nothing else.
  // The cost code is applied further down — it can only be set once the picked
  // job's cost codes have loaded.
  const wantedRef = useRef<LastUsed | null>(null);
  useEffect(() => {
    const pick = readLastPick(me?.email) ?? lastUsed;
    if (!pick?.jobId) return;
    wantedRef.current = pick;
    setJobId((cur) => cur || pick.jobId);
    if (pick.payType) setPayType((cur) => cur || pick.payType);
  }, [me, lastUsed]);

  // A job's cost codes (its budget cost items). Reload on job change.
  useEffect(() => {
    setCostItemId("");
    setCostItems([]);
    if (!jobId) return;
    setLoadingCosts(true);
    fetch(`/api/employee-time?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => {
        const items: CostItem[] = j.ok === false ? [] : (j.costItems ?? []);
        setCostItems(items);
        // Re-select the remembered cost code, but only on the job it belongs to
        // and only if that job still carries it.
        const want = wantedRef.current;
        if (want && want.jobId === jobId && want.costItemId) {
          if (items.some((c) => c.id === want.costItemId)) setCostItemId(want.costItemId);
        }
      })
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

  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobId) ?? null, [jobs, jobId]);
  const jobLabelText = selectedJob ? jobRefLabel(selectedJob) : "";
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

  // The clock-out time follows the wall clock until it is edited.
  useEffect(() => {
    if (endTouched) return;
    const id = setInterval(() => setEndAt(nowLocal()), 20000);
    return () => clearInterval(id);
  }, [endTouched]);

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

  // The start and stop times the clock-out will send, and how long that makes
  // the shift. An untouched start stays exactly as the clock-in recorded it
  // (seconds included); a touched one is used as typed, to the minute.
  const clockOutStart = activeClock
    ? outStartTouched
      ? `${outStartAt}:00`
      : activeClock.startedAt
    : "";
  const clockOutEnd = endTouched ? `${endAt}:00` : "";
  const clockOutDuration = activeClock
    ? fmtDuration(clockOutStart, clockOutEnd || nowLocalSeconds())
    : "";

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
        employee: effectiveName,
      };
      setActiveClock(clock);
      setClockNote("");
      saveClock(clock);
      saveLastPick(me?.email, {
        jobId,
        costItemId,
        costCode: selectedCost?.number ?? "",
        payType,
      });
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
    // An edited stop time is used as typed (to the minute); an untouched one is
    // "right now", to the second.
    const endedAt = endTouched ? `${endAt}:00` : nowLocalSeconds();
    const startedAt = clockOutStart;
    if (!startedAt) {
      setErr("Missing the clock-in time.");
      return;
    }
    if (new Date(startedAt).getTime() > Date.now() + 60000) {
      setErr("That start time is in the future.");
      return;
    }
    if (new Date(endedAt).getTime() > Date.now() + 60000) {
      setErr("That stop time is in the future.");
      return;
    }
    // JobTread requires end > start strictly; a sub-second session would 400.
    // That's a mis-tap, not real work — point at Cancel instead.
    if (endedAt <= startedAt) {
      setErr(
        endTouched || outStartTouched
          ? "The stop time must be after the start time."
          : "You've been clocked in less than a second — use “Cancel this clock-in” instead.",
      );
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
          startTime: startedAt,
          // Only a corrected start is written back to JobTread — an untouched
          // one is already the entry's own startedAt.
          startEdited: outStartTouched,
          endTime: endedAt,
          note: note.trim(),
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
          startTime: startedAt,
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
      setEndAt(nowLocal());
      setEndTouched(false);
      setOutStartAt(nowLocal());
      setOutStartTouched(false);
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
          photos,
        }),
      });
      const json: SubmitResult = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not save the time entry.");
        return;
      }
      manualKeyRef.current = ""; // clean success → next submission gets a new key
      saveLastPick(me?.email, {
        jobId,
        costItemId,
        costCode: selectedCost?.number ?? "",
        payType,
      });
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
    photos,
    me,
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

  // The month picker's options, recomputed only when the month steps outside them.
  const monthPicks = useMemo(() => monthChoices(historyMonth), [historyMonth]);

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

  // The edit sheet's cost codes — the picked job's budget cost items, reloaded
  // whenever the edited entry's job changes. Mirrors the clock form's own cost
  // effect but on the edit-only job state, so the two never cross.
  useEffect(() => {
    if (!editEntry) return; // only while the edit sheet is live
    setEditCostItemId("");
    setEditCostItems([]);
    if (!editJobId) return;
    setEditLoadingCosts(true);
    fetch(`/api/employee-time?jobId=${encodeURIComponent(editJobId)}`)
      .then((r) => r.json())
      .then((j) => {
        const items: CostItem[] = j.ok === false ? [] : (j.costItems ?? []);
        setEditCostItems(items);
        const want = editWantCostRef.current;
        if (want && want.jobId === editJobId && want.costItemId) {
          if (items.some((c) => c.id === want.costItemId)) setEditCostItemId(want.costItemId);
        }
      })
      .catch(() => setEditCostItems([]))
      .finally(() => setEditLoadingCosts(false));
    // editEntry is only read to gate the fetch; the job id is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editJobId]);

  // Open the editor on one entry, pre-filled. Running entries aren't editable
  // here (they're closed out from the Time clock tab), so this is only wired to
  // closed rows.
  function openEdit(e: HistoryEntry) {
    setEditEntry(e);
    setEditErr("");
    setEditMsg("");
    setEditNote(e.notes ?? "");
    setEditStart(`${e.date}T${e.startTime || "00:00"}`);
    setEditEnd(`${e.date}T${e.endTime || "00:00"}`);
    editWantCostRef.current = { jobId: e.jobId, costItemId: e.costItemId };
    // Set the cost item directly too: the load effect only re-runs when the job
    // id actually changes, so reopening a different entry on the SAME job would
    // otherwise keep the previous row's cost code selected.
    setEditCostItemId(e.costItemId);
    setEditJobId(e.jobId); // triggers the cost-items load + cost-code re-select
    openSheet("edit");
  }

  function closeEdit() {
    setSheet(null);
    setReturnSheet(null);
    setEditEntry(null);
  }

  const editSelectedJob = useMemo(
    () => jobs.find((j) => j.id === editJobId) ?? null,
    [jobs, editJobId],
  );
  // The picked job's label. Falls back to the entry's own job name when the job
  // isn't in the loaded list (and hasn't been changed), so a valid entry never
  // reads "Select a job".
  const editJobLabelText = editSelectedJob
    ? jobRefLabel(editSelectedJob)
    : editEntry && editEntry.jobId === editJobId
      ? editEntry.jobName
      : "";
  const editSelectedCost = editCostItems.find((c) => c.id === editCostItemId) ?? null;
  const editCostLabelText = editSelectedCost
    ? `${editSelectedCost.number}${editSelectedCost.name ? ` — ${editSelectedCost.name}` : ""}`
    : "";
  const editDuration = fmtDuration(editStart, editEnd);

  // Save the edit — an updateTimeEntry on the entry's own id. Re-times, re-jobs
  // and re-codes it in one write; the note is required, same as everywhere else.
  async function saveEdit() {
    if (!editEntry) return;
    setEditErr("");
    setEditMsg("");
    if (!editJobId) {
      setEditErr("Pick a job.");
      return;
    }
    if (!editCostItemId) {
      setEditErr("Pick a cost code.");
      return;
    }
    if (!editNote.trim()) {
      setEditErr("A note is required.");
      return;
    }
    if (!editStart || !editEnd) {
      setEditErr("Enter a start and stop time.");
      return;
    }
    if (new Date(editEnd).getTime() <= new Date(editStart).getTime()) {
      setEditErr("Stop time must be after the start time.");
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "edit",
          entryId: editEntry.id,
          jobId: editJobId,
          jobLabel: editJobLabelText,
          costItemId: editCostItemId,
          costCode: editSelectedCost?.number ?? "",
          startTime: editStart,
          endTime: editEnd,
          note: editNote.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setEditErr(json.error || "Could not save your changes.");
        return;
      }
      if (json.previewed) {
        // Writes are off on this deployment — nothing changed in JobTread, so a
        // reload would just show the old figures. Say so and leave the sheet up.
        setEditMsg("Writes are off on this deployment — nothing was changed in JobTread.");
        return;
      }
      closeEdit();
      await loadHistory(); // re-pull so the row shows the new time/job/code
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : "Could not save your changes.");
    } finally {
      setEditBusy(false);
    }
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
              Sent to the Time Entries record. JobTread push is OFF
              (COMPANION_WRITES_ENABLED not set) — nothing will be written to JobTread.
            </Banner>
          ) : done.result.accepted ? (
            /* The server has the entry and is finishing it — the photos, the
               record, then the JobTread push. Saying "sent" rather than
               "pushed" is the honest word for what is known at this point; the
               entry itself shows up under Timesheets. */
            <Banner tone="success">
              Sent. Your time is being filed and pushed to JobTread — you can close the app.
              It appears under Timesheets once JobTread has it.
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
            {done.result.photoCount ? (
              <Row
                label="Photos"
                value={`${done.result.photoCount} ${done.result.accepted ? "sent" : "saved"}`}
              />
            ) : null}
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
                  sub={selectedJob ? jobAddress(selectedJob) || undefined : undefined}
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
              onClick={
                running
                  ? () => {
                      // Always open on "now"; an earlier stop is a deliberate edit.
                      setEndAt(nowLocal());
                      setEndTouched(false);
                      // The start opens on the clock's own time — correcting it
                      // is the deliberate edit here.
                      setOutStartAt((activeClock?.startedAt || nowLocal()).slice(0, 16));
                      setOutStartTouched(false);
                      setErr("");
                      openSheet("out");
                    }
                  : clockIn
              }
              disabled={busy || resolving}
              className={`min-w-[220px] rounded-full px-10 py-4 text-lg font-bold shadow-lg transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                running
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-accent text-accent-fg hover:bg-accent-hover"
              }`}
            >
              {busy ? "Working…" : resolving ? "Checking…" : running ? "Clock out" : "Clock in"}
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
          {/* Pay period: pick the month (arrows step it), then the two halves
              + an open filter. */}
          <div className="flex items-center gap-2">
            <IconButton label="Previous month" onClick={() => setHistoryMonth((m) => shiftMonth(m, -1))}>
              ‹
            </IconButton>
            <Select
              aria-label="Month"
              value={historyMonth}
              onChange={(e) => setHistoryMonth(e.target.value)}
              className="min-h-11 flex-1 text-center text-sm font-bold"
            >
              {monthPicks.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
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
            dayGroups.map((g) => <DaySection key={g.date} group={g} onEdit={openEdit} />)
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
            {busy ? "Saving…" : `Clock out — ${clockOutDuration || elapsed}`}
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
        {/* Stop time — "now" unless you say otherwise. This is the fix for a
            clock-out nobody remembered at 3 o'clock. */}
        <Card pad={false} className="mb-4 overflow-hidden">
          {/* Start time — the clock's own, correctable here. This is the fix for
              a crew member who started at 7 and only clocked in at 9. */}
          {activeClock && (
            <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-line-soft px-3 py-2.5">
              <span className="text-[13px] text-neutral-500">
                Start time
                {outStartTouched ? (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">edited</span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <ChipInput
                  type="date"
                  value={outStartAt.slice(0, 10)}
                  display={dayChipLabel(outStartAt.slice(0, 10))}
                  ariaLabel="Start date"
                  onChange={(v) => {
                    if (!v) return;
                    setOutStartTouched(true);
                    setOutStartAt(`${v}T${outStartAt.slice(11, 16)}`);
                  }}
                />
                <ChipInput
                  type="time"
                  value={outStartAt.slice(11, 16)}
                  display={fmt12h(outStartAt.slice(11, 16))}
                  ariaLabel="Start time"
                  onChange={(v) => {
                    if (!v) return;
                    setOutStartTouched(true);
                    setOutStartAt(`${outStartAt.slice(0, 10)}T${v.slice(0, 5)}`);
                  }}
                />
              </span>
            </div>
          )}
          <div className="flex min-h-[56px] items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-[13px] text-neutral-500">
              Stop time
              {clockOutDuration ? (
                <span className="ml-2 text-neutral-400">{clockOutDuration}</span>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              <ChipInput
                type="date"
                value={endAt.slice(0, 10)}
                display={dayChipLabel(endAt.slice(0, 10))}
                ariaLabel="Stop date"
                onChange={(v) => {
                  if (!v) return;
                  setEndTouched(true);
                  setEndAt(`${v}T${endAt.slice(11, 16)}`);
                }}
              />
              <ChipInput
                type="time"
                value={endAt.slice(11, 16)}
                display={fmt12h(endAt.slice(11, 16))}
                ariaLabel="Stop time"
                onChange={(v) => {
                  if (!v) return;
                  setEndTouched(true);
                  setEndAt(`${endAt.slice(0, 10)}T${v.slice(0, 5)}`);
                }}
              />
            </span>
          </div>
        </Card>

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

      {/* Edit a timesheet entry — the same editor, pointed at an existing entry.
          Updates it in place (updateTimeEntry) instead of creating a new one. */}
      <Sheet
        open={sheet === "edit"}
        title="Edit time"
        tall
        onClose={closeEdit}
        footer={
          <button
            type="button"
            onClick={saveEdit}
            disabled={editBusy}
            className="w-full rounded-full bg-accent px-4 py-3.5 text-base font-bold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editBusy ? "Saving…" : "Save changes"}
          </button>
        }
      >
        {editErr && (
          <Banner tone="error" className="mb-3">
            {editErr}
          </Banner>
        )}
        {editMsg && (
          <Banner tone="warning" className="mb-3">
            {editMsg}
          </Banner>
        )}
        {editEntry?.approved && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            This entry is already approved — saving a change re-opens it for the office to review.
          </p>
        )}

        <Card pad={false} className="overflow-hidden">
          <FieldRow
            label="Job"
            value={editJobLabelText || "Select a job"}
            placeholder={!editJobLabelText}
            sub={editSelectedJob ? jobAddress(editSelectedJob) || undefined : undefined}
            onClick={() => openSheet("editjob", "edit")}
          />
          <FieldRow
            label="Cost code"
            value={
              editCostLabelText ||
              (!editJobId
                ? "Pick a job first"
                : editLoadingCosts
                  ? "Loading cost codes…"
                  : editCostItems.length
                    ? "Select a cost code"
                    : "No cost codes on this job")
            }
            placeholder={!editCostLabelText}
            onClick={editJobId && editCostItems.length ? () => openSheet("editcost", "edit") : undefined}
          />
          {editEntry?.payType && <FieldRow label="Pay type" value={editEntry.payType} static />}
        </Card>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="et-edit-start">Start</Label>
            <Input
              id="et-edit-start"
              type="datetime-local"
              value={editStart}
              onChange={(e) => setEditStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="et-edit-end">Stop</Label>
            <Input
              id="et-edit-end"
              type="datetime-local"
              value={editEnd}
              onChange={(e) => setEditEnd(e.target.value)}
            />
          </div>
        </div>
        {editDuration && (
          <p className="mt-1 text-xs text-neutral-500">
            {editDuration} — changing the times updates the hours (and the entry&apos;s cost).
          </p>
        )}

        <div className="mt-3">
          <Label htmlFor="et-edit-note">Note (required)</Label>
          <Textarea
            id="et-edit-note"
            rows={3}
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="What did you work on?"
          />
        </div>

        {editEntry && (
          <p className="mt-4 pb-2 text-center">
            <JtLink href={editEntry.jtUrl} className="text-xs font-semibold text-neutral-400 hover:text-accent">
              View in JobTread ↗
            </JtLink>
          </p>
        )}
      </Sheet>

      {/* Edit's own job picker — sets the edit-only job state, then hands the
          screen back to the edit sheet. */}
      <JobSheet
        open={sheet === "editjob"}
        jobs={jobs}
        selectedId={editJobId}
        onPick={(j) => {
          setEditJobId(j.id);
          closeSheet();
        }}
        onClose={closeSheet}
      />

      {/* Edit's own cost-code picker. */}
      <CostSheet
        open={sheet === "editcost"}
        items={editCostItems}
        selectedId={editCostItemId}
        onPick={(c) => {
          setEditCostItemId(c.id);
          closeSheet();
        }}
        onClose={closeSheet}
      />
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
function DaySection({ group, onEdit }: { group: DayGroup; onEdit: (e: HistoryEntry) => void }) {
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
          <EntryRow key={e.id} e={e} onEdit={onEdit} />
        ))}
      </Card>
    </section>
  );
}

/** The inner content of a timesheet row — job, customer/code, note, hours. */
function EntryBody({ e }: { e: HistoryEntry }) {
  return (
    <>
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
    </>
  );
}

/**
 * A timesheet row. A CLOSED entry taps into the companion editor (openEdit) so
 * the crew member can fix its time/job/cost/note on the phone instead of being
 * bounced to JobTread. A still-RUNNING entry has no span to edit yet — it's
 * closed out from the Time clock tab — so it keeps the JobTread deep-link.
 */
function EntryRow({ e, onEdit }: { e: HistoryEntry; onEdit: (e: HistoryEntry) => void }) {
  const rowClass =
    "flex w-full items-start justify-between gap-3 border-b border-line-soft px-3 py-3 text-left last:border-b-0";
  if (e.open) {
    return (
      <JtLink href={e.jtUrl} className={rowClass}>
        <EntryBody e={e} />
      </JtLink>
    );
  }
  return (
    <button type="button" onClick={() => onEdit(e)} className={`${rowClass} transition active:bg-accent/10`}>
      <EntryBody e={e} />
    </button>
  );
}
