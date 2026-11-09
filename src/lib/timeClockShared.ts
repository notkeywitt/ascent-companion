/**
 * What the Time page (/employee-time) and the time bug (components/TimeBug.tsx)
 * share in the browser: the device's copy of the running clock and the note in
 * progress, and the events each sends when it changes the clock.
 *
 * Both screens can be open at once — the bug floats over every page on a
 * desktop, the Time page included. Each one changes the SAME JobTread entry, so
 * each must hear what the other did: a page still holding the entry the bug
 * just switched away from would clock out of the wrong entry.
 *
 * Client-only. Every storage call is wrapped, because private windows and
 * blocked site data throw.
 */

export const LS_CLOCK = "employeeTime.activeClock";
export const LS_NOTE = "employeeTime.note"; // the note in progress, kept across visits

// A note typed with no clock running is dropped after this long, so a note
// abandoned in Log a range never turns up days later on someone else's shift.
// A note that belongs to a RUNNING clock ignores this — it stands until that
// clock is closed, however long the crew member stays on it.
export const NOTE_TTL_MS = 12 * 60 * 60 * 1000;

/** The note in progress: what was typed, which clock it was typed on, when. */
export interface SavedNote {
  note: string;
  entryId: string; // the running clock it belongs to ("" = typed with no clock)
  savedAt: number;
}

export function readSavedNote(): SavedNote | null {
  try {
    const raw = localStorage.getItem(LS_NOTE);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<SavedNote>;
    if (!s || typeof s.note !== "string" || !s.note.trim()) return null;
    return { note: s.note, entryId: s.entryId ?? "", savedAt: Number(s.savedAt) || 0 };
  } catch {
    return null;
  }
}

export function saveNote(note: string, entryId: string) {
  try {
    if (!note.trim()) {
      localStorage.removeItem(LS_NOTE);
      return;
    }
    const rec: SavedNote = { note, entryId, savedAt: Date.now() };
    localStorage.setItem(LS_NOTE, JSON.stringify(rec));
  } catch {}
}

export function clearSavedNote() {
  try {
    localStorage.removeItem(LS_NOTE);
  } catch {}
}

/** The saved note when it belongs to this clock, or is still fresh; else "". */
export function savedNoteFor(entryId: string): string {
  const s = readSavedNote();
  if (!s) return "";
  if (s.entryId && s.entryId === entryId) return s.note;
  if (!s.entryId && Date.now() - s.savedAt < NOTE_TTL_MS) return s.note;
  return "";
}

/* ── Entries clocked out a moment ago ───────────────────────────────────────
   A clock-out finishes on the server a few seconds after the answer, so
   JobTread can still show the entry running. A screen that reads it in that
   gap must not pick it back up. Kept on the device, not in one component, so
   the bug's clock-out also protects the Time page and the other way round. */
const LS_JUST_CLOSED = "employeeTime.justClosed";
const JUST_CLOSED_MS = 2 * 60 * 1000;

export function rememberClosed(entryId: string) {
  if (!entryId) return;
  try {
    const now = Date.now();
    const kept = readClosedMap().filter(([, at]) => now - at < JUST_CLOSED_MS);
    kept.push([entryId, now]);
    localStorage.setItem(LS_JUST_CLOSED, JSON.stringify(kept));
  } catch {}
}

export function recentlyClosed(): string[] {
  const now = Date.now();
  return readClosedMap()
    .filter(([, at]) => now - at < JUST_CLOSED_MS)
    .map(([id]) => id);
}

function readClosedMap(): [string, number][] {
  try {
    const raw = localStorage.getItem(LS_JUST_CLOSED);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => Array.isArray(x) && typeof x[0] === "string") : [];
  } catch {
    return [];
  }
}

/* ── Events between the two screens ───────────────────────────────────────── */

export type ClockSource = "page" | "bug";

/** The clock changed. The listener re-reads JobTread. */
export interface ClockChange {
  source: ClockSource;
  /** Entries the sender just closed. */
  closed?: string[];
  /** One line for the other screen to show, e.g. what the switch did. */
  message?: string;
}
const CLOCK_EVENT = "ascent:clock-changed";
const NOTE_EVENT = "ascent:clock-note";

export function announceClock(change: ClockChange) {
  for (const id of change.closed ?? []) rememberClosed(id);
  try {
    window.dispatchEvent(new CustomEvent<ClockChange>(CLOCK_EVENT, { detail: change }));
  } catch {}
}

export function onClockChange(fn: (c: ClockChange) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<ClockChange>).detail);
  window.addEventListener(CLOCK_EVENT, h);
  return () => window.removeEventListener(CLOCK_EVENT, h);
}

/** The note was typed on one screen; the other mirrors it. */
export function announceNote(source: ClockSource, note: string) {
  try {
    window.dispatchEvent(new CustomEvent(NOTE_EVENT, { detail: { source, note } }));
  } catch {}
}

export function onNoteChange(fn: (source: ClockSource, note: string) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<{ source: ClockSource; note: string }>).detail;
    fn(d.source, d.note);
  };
  window.addEventListener(NOTE_EVENT, h);
  return () => window.removeEventListener(NOTE_EVENT, h);
}

/* ── The bug's own settings (per device) ────────────────────────────────────
   Dismissed: until the next clock-in. The Time page's Clock in clears it; a
   clock-in on another device shows the bug again the next day, because the
   dismissal is stamped with the day it was made. */
const LS_BUG_SIDE = "timeBug.side";
const LS_BUG_DISMISSED = "timeBug.dismissedOn";
const BUG_OPEN_EVENT = "ascent:timebug-open";

export type BugSide = "left" | "right";

export function readBugSide(): BugSide {
  try {
    return localStorage.getItem(LS_BUG_SIDE) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

export function saveBugSide(side: BugSide) {
  try {
    localStorage.setItem(LS_BUG_SIDE, side);
  } catch {}
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isBugDismissed(): boolean {
  try {
    return localStorage.getItem(LS_BUG_DISMISSED) === today();
  } catch {
    return false;
  }
}

export function dismissBug() {
  try {
    localStorage.setItem(LS_BUG_DISMISSED, today());
  } catch {}
}

/** Show the bug again — the Time page's clock-in and its "Show time bug" button. */
export function showTimeBug() {
  try {
    localStorage.removeItem(LS_BUG_DISMISSED);
  } catch {}
  try {
    window.dispatchEvent(new Event(BUG_OPEN_EVENT));
  } catch {}
}

export function onShowTimeBug(fn: () => void): () => void {
  window.addEventListener(BUG_OPEN_EVENT, fn);
  return () => window.removeEventListener(BUG_OPEN_EVENT, fn);
}
