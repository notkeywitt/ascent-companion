"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAccess } from "@/components/AccessProvider";
import { jobLabel, type JobRef } from "@/components/JobPicker";
import { Button, Input, Label, Select, Spinner, Textarea } from "@/components/ui";
import { defaultCostCode, matchPayType, type CostCodeDefault, type PayTypeRule } from "@/lib/payTypeMatch";
import {
  LS_CLOCK,
  announceClock,
  announceNote,
  clearSavedNote,
  dismissBug,
  isBugDismissed,
  onClockChange,
  onNoteChange,
  onShowTimeBug,
  readBugPopped,
  readBugSide,
  saveBugPopped,
  recentlyClosed,
  saveBugSide,
  saveNote,
  savedNoteFor,
  type BugSide,
} from "@/lib/timeClockShared";

/**
 * The time bug — a small clock that floats in a bottom corner of every page on
 * a DESKTOP (1024px and up), so the person on the clock can switch work or
 * clock out without leaving what they are doing.
 *
 *   Job   — the running entry's job
 *   Work  — its cost code
 *   Start / End — the entry's hours. Start is the clock-in; change it to
 *           correct a late clock-in. End follows the clock until changed; it
 *           is when Clock out or Switch closes the entry.
 *   Notes — the note the entry closes with (required)
 *   [Switch] [Clock out]
 *
 * Switch stamps the moment it is pressed (or the End box, if changed) and asks
 * for the next job and work. Start new entry then closes the running entry at that moment, with the note, and opens
 * the new one at the same moment (POST op "switch" — the same call the Time
 * page's Work row makes). Changing the Job or Work box does the same as Switch.
 * Cancel leaves the running entry alone.
 *
 * It opens when the person clocks in on the Time page, and the × hides it for
 * the rest of the day; "Show time bug" on the Time page brings it back. The ⇆
 * moves it to the other corner. Both are per device (lib/timeClockShared).
 *
 * POP OUT (Chrome and Edge only — Document Picture-in-Picture): the ⧉ button
 * moves the bug into its own small window that stays on top of every app, so
 * it floats on the computer's desktop, not only inside the browser. It is the
 * same component, drawn into that window through a portal, so it uses the same
 * sign-in and the same routes. The browser opens such a window only on a
 * click, and closes it when the app's tab closes or reloads. Closing it puts
 * the bug back in the page; the next clock-in on the Time page pops it out
 * again, because that tap is a click.
 *
 * The running clock is JobTread's (GET /api/employee-time/clock), read on load,
 * when the window comes back to the front, every few minutes, and whenever the
 * Time page says it changed the clock. It is always the signed-in person's own
 * clock: the Time page's "acting as" never reaches it.
 */

interface OpenEntry {
  entryId: string;
  startedAt: string; // org-local wall clock "YYYY-MM-DDTHH:MM:SS"
  jobId: string;
  jobLabel: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  payType: string;
  employee: string;
  notes?: string;
}
interface CostItem {
  id: string;
  number: string;
  name: string;
  detail?: string;
}

const DESKTOP_QUERY = "(min-width: 1024px)";
const POLL_MS = 3 * 60 * 1000;

function useIsDesktop(): boolean {
  const [desk, setDesk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}

// Local wall clock to the second — what the clock routes take. Same rule as the
// Time page: JobTread refuses an end that is not after the start.
function nowLocalSeconds(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmt12h(stamp: string): string {
  const [h, m] = stamp.slice(11, 16).split(":").map(Number);
  if (Number.isNaN(h)) return "";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Minutes as "3h 12m". */
function fmtHours(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function fmtDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const costLabel = (c: CostItem) =>
  [c.number, c.name].filter(Boolean).join(" — ") + (c.detail && c.detail !== c.name ? ` · ${c.detail}` : "");

/** This device's record of the clock, as the Time page keeps it. */
function readLocalClock(): (OpenEntry & { logKey?: string; previewed?: boolean; breakStartedAt?: string | null }) | null {
  try {
    const raw = localStorage.getItem(LS_CLOCK);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalClock(c: OpenEntry, previewed: boolean) {
  try {
    localStorage.setItem(
      LS_CLOCK,
      JSON.stringify({
        ...c,
        // Derived from the entry id, like a clock the Time page resumes from
        // JobTread, so both screens send the same clock-out key.
        logKey: c.entryId ? `te-jt-${c.entryId}` : `te-${Date.now()}`,
        previewed,
        jtStatus: previewed ? "not pushed (writes off)" : "pushed",
        resumed: false,
      }),
    );
  } catch {}
}

function clearLocalClock() {
  try {
    localStorage.removeItem(LS_CLOCK);
  } catch {}
}

/* Document Picture-in-Picture is not in TypeScript's DOM types yet. */
interface DocumentPip {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}
function documentPip(): DocumentPip | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;
}

/** Give the pop-out window the app's stylesheets, theme and palette. */
function dressPipWindow(win: Window) {
  const d = win.document;
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.href) {
        const link = d.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        d.head.appendChild(link);
      } else {
        const style = d.createElement("style");
        style.textContent = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join("\n");
        d.head.appendChild(style);
      }
    } catch {
      /* a sheet the browser will not let us read — skip it */
    }
  }
  syncPipTheme(win);
  d.title = "Time";
  d.body.className = "font-sans antialiased bg-white dark:bg-ink-raised";
  d.body.style.margin = "0";
}

/** The theme can change while the window is open; copy <html>'s state again. */
function syncPipTheme(win: Window) {
  const src = document.documentElement;
  const dst = win.document.documentElement;
  dst.className = src.className;
  const palette = src.getAttribute("data-palette");
  if (palette) dst.setAttribute("data-palette", palette);
  dst.setAttribute("style", src.getAttribute("style") ?? "");
}

export function TimeBug() {
  const { can } = useAccess();
  const desktop = useIsDesktop();
  const enabled = desktop && can("employee-time");

  const [clock, setClock] = useState<OpenEntry | null>(null);
  const [dismissed, setDismissed] = useState(true);
  // The pop-out window, while the bug lives in it.
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);
  pipRef.current = pipWin;
  // True while WE close the pop-out (× or nothing to show). Only a close the
  // person makes — the window's own close button — puts the bug back for good.
  const closingRef = useRef(false);
  function closePip(keepPopped: boolean) {
    const win = pipRef.current;
    if (!win) return;
    closingRef.current = keepPopped;
    setPipWin(null);
    win.close();
  }
  const [canPop, setCanPop] = useState(false);
  const [side, setSide] = useState<BugSide>("right");
  const [note, setNote] = useState("");
  const [nowMs, setNowMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  // Switching: the moment Switch was pressed, and the picks for the new entry.
  const [switchAt, setSwitchAt] = useState("");
  // The hours boxes. "" = untouched: Start is the clock-in, End is now (or
  // the moment Switch was pressed). "HH:MM" once the person changes one.
  const [startEdit, setStartEdit] = useState("");
  const [endEdit, setEndEdit] = useState("");
  const [pickJobId, setPickJobId] = useState("");
  const [pickCostId, setPickCostId] = useState("");

  // Reference data, loaded once the bug has a clock to show.
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [costs, setCosts] = useState<{ jobId: string; items: CostItem[] } | null>(null);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [rules, setRules] = useState<{ me: string; pay: PayTypeRule[]; codes: CostCodeDefault[] } | null>(null);
  const [myTypes, setMyTypes] = useState<string[] | null>(null);

  const clockRef = useRef(clock);
  clockRef.current = clock;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    setSide(readBugSide());
    setDismissed(isBugDismissed());
    setCanPop(!!documentPip());
  }, []);

  /** Open the pop-out window. Must run inside a click. */
  const popOut = useCallback(async () => {
    const api = documentPip();
    if (!api || pipRef.current) return;
    try {
      const win = await api.requestWindow({ width: 340, height: 500 });
      dressPipWindow(win);
      // Closed from its own title bar, or the tab went away: back in the page.
      win.addEventListener("pagehide", () => {
        if (!closingRef.current) saveBugPopped(false);
        closingRef.current = false;
        setPipWin(null);
      });
      saveBugPopped(true);
      setPipWin(win);
    } catch {
      /* no click behind it, or the browser said no — stay in the page */
    }
  }, []);

  // Keep the pop-out's theme in step with the app's.
  useEffect(() => {
    if (!pipWin) return;
    const obs = new MutationObserver(() => syncPipTheme(pipWin));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette", "style"] });
    return () => obs.disconnect();
  }, [pipWin]);

  // A new entry on screen: start from its note (typed here or on the Time
  // page), else the description JobTread holds.
  const shownId = clock?.entryId ?? null;
  useEffect(() => {
    if (shownId === null) return;
    setNote(savedNoteFor(shownId) || clockRef.current?.notes || "");
    setStartEdit("");
    setEndEdit("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  const refresh = useCallback(() => {
    if (busyRef.current) return;
    fetch("/api/employee-time/clock", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; linked?: boolean; openEntry?: OpenEntry | null }) => {
        if (j.ok === false || busyRef.current) return; // can't tell — leave the screen alone
        // Clocked out a moment ago: JobTread can still show it running.
        if (j.openEntry && !recentlyClosed().includes(j.openEntry.entryId)) {
          setClock(j.openEntry);
          return;
        }
        // Writes off: the Time page's preview clock exists on this device only.
        // A clock on break also has no entry id, but it is not running.
        const local = readLocalClock();
        if (local && !local.entryId && local.previewed && !local.breakStartedAt && local.jobId) {
          setClock(local);
          return;
        }
        setClock(null);
        setSwitchAt("");
      })
      .catch(() => {});
  }, []);

  // When to read the clock.
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible" || pipRef.current) refresh();
    }, POLL_MS);
    const offClock = onClockChange((c) => {
      if (c.source === "page") {
        setDone("");
        refresh();
      }
    });
    const offShow = onShowTimeBug(() => {
      setDismissed(false);
      setDone("");
      refresh();
      // Popped out last time: pop out again. This runs inside the Time page's
      // click, so the browser allows it; if not, the bug shows in the page.
      if (readBugPopped()) void popOut();
    });
    const offNote = onNoteChange((source, text) => {
      if (source === "page") setNote(text);
    });
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
      offClock();
      offShow();
      offNote();
    };
  }, [enabled, refresh, popOut]);

  const visible = enabled && !dismissed && (!!clock || !!done);

  // Nothing to show: close the pop-out too. It still counts as popped out.
  useEffect(() => {
    if (!visible && pipWin) closePip(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pipWin]);

  // The clock-out confirmation stays a few seconds, then the bug goes.
  useEffect(() => {
    if (!done || clock) return;
    const t = window.setTimeout(() => setDone(""), 6000);
    return () => window.clearTimeout(t);
  }, [done, clock]);

  // The elapsed time, once a second, only while it is on screen.
  useEffect(() => {
    if (!visible || !clock) return;
    setNowMs(Date.now());
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [visible, clock]);

  // The job list and the pay-type rules, once per session.
  const haveClock = !!clock;
  useEffect(() => {
    if (!visible || !haveClock) return;
    if (!jobs.length) {
      fetch("/api/employee-time/jobs")
        .then((r) => r.json())
        .then((j) => {
          if (j.ok !== false) setJobs(j.jobs ?? []);
        })
        .catch(() => {});
    }
    if (!rules) {
      fetch("/api/employee-time/pay-rules")
        .then((r) => r.json())
        .then((j) => {
          if (j.ok === false) return;
          const pay: PayTypeRule[] = j.rules ?? [];
          const codes: CostCodeDefault[] = j.codeDefaults ?? [];
          // The route returns the signed-in person's rows only, so any row names them.
          setRules({ me: pay[0]?.jtUserId || codes[0]?.jtUserId || "", pay, codes });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, haveClock]);

  // The person's own pay types — a rule naming one they don't have is ignored,
  // the same check the Time page makes. Asked when a switch starts.
  function loadMyTypes() {
    if (myTypes) return;
    fetch("/api/employee-time")
      .then((r) => r.json())
      .then((j: { ok?: boolean; me?: { jtUserId?: string }; jtUsers?: { id: string; types?: { name: string }[] }[] }) => {
        if (j.ok === false) return;
        const id = j.me?.jtUserId ?? "";
        const u = (j.jtUsers ?? []).find((x) => x.id === id);
        if (u?.types) setMyTypes(u.types.map((t) => t.name));
        if (id) setRules((r) => (r ? { ...r, me: id } : r));
      })
      .catch(() => {});
  }

  // The Work list for the job in the Job box.
  const switching = !!switchAt;
  const jobInBox = switching ? pickJobId : (clock?.jobId ?? "");
  useEffect(() => {
    if (!visible || !jobInBox || costs?.jobId === jobInBox) return;
    let alive = true;
    setLoadingCosts(true);
    fetch(`/api/employee-time?jobId=${encodeURIComponent(jobInBox)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const items: CostItem[] = j.ok === false ? [] : (j.costItems ?? []);
        setCosts({ jobId: jobInBox, items });
      })
      .catch(() => {
        if (alive) setCosts({ jobId: jobInBox, items: [] });
      })
      .finally(() => {
        if (alive) setLoadingCosts(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, jobInBox]);

  // A new job in the Job box starts on the office's default code for this
  // person on that job (/labor-rates), if it has one.
  useEffect(() => {
    if (!switching || costs?.jobId !== pickJobId || pickCostId) return;
    const code = rules ? defaultCostCode(rules.codes, { jtUserId: rules.me, jobId: pickJobId }) : "";
    const hit = code ? costs.items.find((c) => c.number === code) : undefined;
    if (hit) setPickCostId(hit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switching, costs, pickJobId]);

  if (!visible) return null;

  function typeNote(text: string) {
    setNote(text);
    saveNote(text, clock?.entryId ?? "");
    announceNote("bug", text);
  }

  // The entry's start and end as the boxes say, "YYYY-MM-DDTHH:MM:SS". An
  // edited Start keeps the clock-in's day; an edited End is today.
  function startStamp(): string {
    if (!clock) return "";
    return startEdit ? `${clock.startedAt.slice(0, 10)}T${startEdit}:00` : clock.startedAt;
  }
  function endStamp(): string {
    if (endEdit) return `${nowLocalSeconds().slice(0, 10)}T${endEdit}:00`;
    return switchAt || nowLocalSeconds();
  }
  /** The hours, checked. Returns an error to show, or "". */
  function checkHours(start: string, end: string): string {
    const limit = Date.now() + 60000;
    if (new Date(start).getTime() > limit) return "The start time is in the future.";
    if (new Date(end).getTime() > limit) return "The end time is in the future.";
    if (end <= start) {
      return startEdit || endEdit
        ? "The end time must be after the start time."
        : "You clocked in less than a second ago. Use the Time page to cancel the clock-in.";
    }
    return "";
  }

  function startSwitch(next?: { jobId?: string; costId?: string }) {
    if (!clock) return;
    setErr("");
    if (!switching) {
      setSwitchAt(endStamp());
      setPickJobId(clock.jobId);
      setPickCostId(clock.costItemId);
      loadMyTypes();
    }
    if (next?.jobId !== undefined) {
      setPickJobId(next.jobId);
      setPickCostId("");
    }
    if (next?.costId !== undefined) setPickCostId(next.costId);
  }

  function cancelSwitch() {
    setSwitchAt("");
    setErr("");
  }

  async function confirmSwitch() {
    if (!clock || !switchAt) return;
    if (!note.trim()) {
      setErr("Write a note first. It goes on the entry you are closing.");
      return;
    }
    if (!pickJobId) {
      setErr("Pick a job.");
      return;
    }
    if (!pickCostId) {
      setErr("Pick the work.");
      return;
    }
    if (pickJobId === clock.jobId && pickCostId === clock.costItemId) {
      setErr("Pick a different job or work, or tap Cancel.");
      return;
    }
    const item = costs?.jobId === pickJobId ? costs.items.find((c) => c.id === pickCostId) : undefined;
    const job = jobs.find((j) => j.id === pickJobId);
    // The new job and code may carry their own pay type in the office's table.
    const ruled = rules ? matchPayType(rules.pay, { jtUserId: rules.me, jobId: pickJobId, costCode: item?.number ?? "" }) : "";
    const payType = ruled && (!myTypes || myTypes.includes(ruled)) ? ruled : clock.payType;
    const closedNote = note.trim();
    const entryStart = startStamp();
    const at = endStamp();
    const bad = checkHours(entryStart, at);
    if (bad) {
      setErr(bad);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "switch",
          entryId: clock.entryId,
          jobId: pickJobId,
          costItemId: pickCostId,
          payType,
          // The switch moment: the old entry ends and the new one starts here.
          startTime: at,
          startEdited: !!startEdit,
          entryStart,
          note: closedNote,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not switch.");
        // The old entry closed but the new one never started: off the clock.
        if (json.closed) {
          clearLocalClock();
          clearSavedNote();
          setClock(null);
          setSwitchAt("");
          setDone(json.error || "Your entry was closed, but the new one did not start. Clock in again.");
          announceClock({ source: "bug", closed: [clock.entryId] });
        }
        return;
      }
      const next: OpenEntry = {
        entryId: json.entryId || "",
        startedAt: json.startedAt || at,
        jobId: pickJobId,
        jobLabel: job ? jobLabel(job) : clock.jobLabel,
        costItemId: pickCostId,
        costCode: item?.number ?? "",
        costItemName: item?.name ?? "",
        payType,
        employee: clock.employee,
        notes: "",
      };
      writeLocalClock(next, !!json.previewed);
      // The note went out with the closed entry; the new one starts blank.
      clearSavedNote();
      setNote("");
      setClock(next);
      setSwitchAt("");
      announceClock({
        source: "bug",
        message: `Switched at ${fmt12h(at)}. The hours before it stay on ${clock.costCode || "the old code"}.`,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not switch.");
    } finally {
      setBusy(false);
    }
  }

  async function clockOut() {
    if (!clock) return;
    if (!note.trim()) {
      setErr("A note is required to clock out.");
      return;
    }
    const startTime = startStamp();
    const endTime = endStamp();
    const bad = checkHours(startTime, endTime);
    if (bad) {
      setErr(bad);
      return;
    }
    const local = readLocalClock();
    const logKey = local?.entryId === clock.entryId && local.logKey ? local.logKey : `te-jt-${clock.entryId}`;
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/employee-time/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "out",
          clientKey: logKey,
          entryId: clock.entryId,
          employee: clock.employee,
          jobId: clock.jobId,
          jobLabel: clock.jobLabel,
          costItemId: clock.costItemId,
          costCode: clock.costCode,
          payType: clock.payType,
          startTime,
          // Only a corrected start is written back to JobTread.
          startEdited: !!startEdit,
          endTime,
          note: note.trim(),
          photos: [],
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not clock out.");
        return;
      }
      clearLocalClock();
      clearSavedNote();
      setNote("");
      setClock(null);
      setSwitchAt("");
      setDone(`Clocked out at ${fmt12h(endTime)}.`);
      announceClock({ source: "bug", closed: clock.entryId ? [clock.entryId] : [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not clock out.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    closePip(true); // × hides the bug; it stays popped out for next time
    dismissBug();
    setDismissed(true);
    setDone("");
    setSwitchAt("");
  }

  function flip() {
    const s: BugSide = side === "right" ? "left" : "right";
    setSide(s);
    saveBugSide(s);
  }

  // Above any docked commit bar. On the left it also clears the help mark,
  // which sits in that corner beside the rail. In the pop-out it fills the window.
  const place: React.CSSProperties | undefined = pipWin
    ? undefined
    : {
        bottom: "calc(var(--actionbar-bottom) + var(--actionbar-h) + 0.5rem)",
        ...(side === "left" ? { left: "calc(var(--rail-w) + 2.75rem)" } : { right: "1rem" }),
      };
  const iconBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-accent/10 hover:text-accent dark:text-neutral-400";

  // The Job box always offers the running job, even one the list leaves out.
  const jobOptions = clock && !jobs.some((j) => j.id === clock.jobId)
    ? [{ id: clock.jobId, label: clock.jobLabel || "Current job" }, ...jobs.map((j) => ({ id: j.id, label: jobLabel(j) }))]
    : jobs.map((j) => ({ id: j.id, label: jobLabel(j) }));
  const costItems = costs?.jobId === jobInBox ? costs.items : [];
  const costInBox = switching ? pickCostId : (clock?.costItemId ?? "");
  const costOptions =
    clock && !switching && !costItems.some((c) => c.id === clock.costItemId)
      ? [{ id: clock.costItemId, label: [clock.costCode, clock.costItemName].filter(Boolean).join(" — ") || "Current work" }, ...costItems.map((c) => ({ id: c.id, label: costLabel(c) }))]
      : costItems.map((c) => ({ id: c.id, label: costLabel(c) }));

  const startMs = clock ? new Date(clock.startedAt).getTime() : 0;
  // The hours boxes' figures, redrawn with the elapsed clock.
  const nowStamp = nowLocalSeconds();
  const todayYmd = nowStamp.slice(0, 10);
  const shownEnd = (switchAt || nowStamp).slice(11, 16);
  const startBoxMs = clock ? new Date(startStamp()).getTime() : 0;
  const endMs = endEdit ? new Date(`${todayYmd}T${endEdit}:00`).getTime() : switchAt ? new Date(switchAt).getTime() : nowMs || Date.now();

  const bug = (
    <aside
      aria-label="Time clock"
      style={place}
      className={
        pipWin
          ? "min-h-screen w-full bg-white text-neutral-900 dark:bg-ink-raised dark:text-neutral-100"
          : "fixed z-40 w-80 rounded-xl border border-line bg-white shadow-lg dark:bg-ink-raised"
      }
    >
      <div className="flex items-center gap-2 border-b border-line-soft py-1 pl-3 pr-1">
        {clock ? (
          <>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
            <span className="text-sm font-semibold">Clocked in</span>
            <span className="text-sm tabular-nums text-neutral-500">{nowMs ? fmtElapsed(nowMs - startMs) : ""}</span>
          </>
        ) : (
          <span className="text-sm font-semibold">Time</span>
        )}
        <span className="flex-1" />
        {canPop && (
          <button
            type="button"
            onClick={() => (pipWin ? closePip(false) : void popOut())}
            aria-label={pipWin ? "Put back in the page" : "Pop out — float above every window"}
            title={pipWin ? "Put back in the page" : "Pop out — float above every window"}
            className={iconBtn}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              {pipWin ? (
                <path d="M2 3h12v10H2zM6 6v4h4" strokeLinejoin="round" />
              ) : (
                <path d="M9 2h5v5M14 2L8 8M12 10v4H2V4h4" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        )}
        {!pipWin && (
        <button
          type="button"
          onClick={flip}
          aria-label={side === "right" ? "Move to the left corner" : "Move to the right corner"}
          title={side === "right" ? "Move to the left corner" : "Move to the right corner"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-accent/10 hover:text-accent dark:text-neutral-400"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close the time bug"
          title="Close — reopen it from the Time page"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-accent/10 hover:text-accent dark:text-neutral-400"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {!clock ? (
        <p className="px-3 py-3 text-sm text-neutral-600 dark:text-neutral-300">{done}</p>
      ) : (
        <div className="space-y-2 px-3 pb-3 pt-2">
          {switching && (
            <p className="text-xs text-neutral-500">
              Your entry closes at {fmt12h(endEdit ? `${todayYmd}T${endEdit}` : switchAt)}. Pick the next job and
              work, then tap Start new entry.
            </p>
          )}
          <div>
            <Label htmlFor="timebug-job">Job</Label>
            <Select
              id="timebug-job"
              value={jobInBox}
              disabled={busy}
              onChange={(e) => startSwitch({ jobId: e.target.value })}
            >
              {jobOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="timebug-work">Work</Label>
            <Select
              id="timebug-work"
              value={costInBox}
              disabled={busy || loadingCosts}
              onChange={(e) => startSwitch({ costId: e.target.value })}
            >
              {loadingCosts ? (
                <option value={costInBox}>Loading…</option>
              ) : (
                <>
                  {!costInBox && <option value="">Pick the work</option>}
                  {costOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </>
              )}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="timebug-start">
                Start
                {clock.startedAt.slice(0, 10) !== todayYmd && (
                  <span className="ml-1 normal-case tracking-normal">· {fmtDay(clock.startedAt.slice(0, 10))}</span>
                )}
              </Label>
              <Input
                id="timebug-start"
                type="time"
                value={startEdit || clock.startedAt.slice(11, 16)}
                disabled={busy}
                onChange={(e) => {
                  setErr("");
                  setStartEdit(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="timebug-end">
                End
                <span className="ml-1 normal-case tracking-normal tabular-nums">· {fmtHours(endMs - startBoxMs)}</span>
              </Label>
              <Input
                id="timebug-end"
                type="time"
                value={endEdit || shownEnd}
                disabled={busy}
                onChange={(e) => {
                  setErr("");
                  setEndEdit(e.target.value);
                  if (switching && e.target.value) setSwitchAt(`${todayYmd}T${e.target.value}:00`);
                }}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="timebug-note">Notes</Label>
            <Textarea
              id="timebug-note"
              rows={3}
              value={note}
              disabled={busy}
              placeholder="What did you work on? Required."
              onChange={(e) => typeNote(e.target.value)}
            />
          </div>
          {err && (
            <p role="alert" className="text-xs text-danger">
              {err}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            {switching ? (
              <>
                <Button variant="secondary" className="flex-1" disabled={busy} onClick={cancelSwitch}>
                  Cancel
                </Button>
                <Button className="flex-1" disabled={busy} onClick={confirmSwitch}>
                  {busy ? <Spinner /> : null}
                  Start new entry
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    if (!note.trim()) {
                      setErr("Write a note first. It goes on the entry you are closing.");
                      return;
                    }
                    startSwitch();
                  }}
                >
                  Switch
                </Button>
                <Button className="flex-1" disabled={busy} onClick={clockOut}>
                  {busy ? <Spinner /> : null}
                  Clock out
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );

  return pipWin ? createPortal(bug, pipWin.document.body) : bug;
}
