/**
 * The running clock's note, kept in JobTread while it is typed, so it follows
 * the crew member from one device to the next.
 *
 * Before this, the note in progress lived only in one browser (timeClockShared's
 * saveNote). Clock in on the phone, type a note, clock out on the desktop: the
 * desktop read JobTread, found no note, and the clock-out wrote the desktop's
 * box over the entry. The phone's note was lost.
 *
 * Now:
 *   - A typed note is saved to the RUNNING JobTread entry (POST op "note") 2 s
 *     after the typing stops, and at once when the box loses focus or the page
 *     is hidden. It is sent only when it differs from what JobTread holds.
 *     An idle box sends nothing.
 *   - Every read of the running clock brings JobTread's note back, and
 *     mergeRemoteNote decides what the box shows.
 *
 * "Synced" is the text this device last knew JobTread to hold for an entry. It
 * is what tells an edit made HERE from one made on another device. It is kept
 * in localStorage so a reload does not forget it.
 *
 * A device saves only after it has read JobTread's note for that entry in this
 * page session (or opened the entry itself). A restored, stale note on a page
 * that has not heard from JobTread yet could otherwise overwrite a newer one.
 *
 * The Time page and the time bug share one copy of this module (the bug's
 * pop-out window is a portal of the same page), so the two never send the
 * same text twice.
 */

/**
 * What the box should show after a read of JobTread.
 *
 * @param local  what the box shows now
 * @param synced what this device last knew JobTread to hold (null = never knew)
 * @param remote what JobTread holds now
 */
export function mergeRemoteNote(local: string, synced: string | null, remote: string): string {
  if (sameNote(local, remote)) return local;
  if (synced !== null) {
    if (sameNote(remote, synced)) return local; // nothing new in JobTread
    if (sameNote(local, synced)) return remote; // nothing new here
  }
  // Both sides changed, or this device never knew. Keep every word.
  if (!remote.trim()) return local;
  if (!local.trim()) return remote;
  if (local.startsWith(remote)) return local; // this box already extends it
  if (remote.startsWith(local)) return remote; // JobTread already extends it
  // Text added here on top of what was synced goes on the end of JobTread's.
  if (synced && local.startsWith(synced)) return remote + local.slice(synced.length);
  return `${remote}\n${local}`;
}

/** Equal but for trailing spaces and new lines, which a save may not keep. */
export function sameNote(a: string, b: string): boolean {
  return a.trimEnd() === b.trimEnd();
}

/* ── Client side ─────────────────────────────────────────────────────────── */

const LS_SYNCED = "employeeTime.noteSynced";
const DEBOUNCE_MS = 2000;

interface SyncedRec {
  entryId: string;
  note: string;
}

function readSyncedRec(): SyncedRec | null {
  try {
    const raw = localStorage.getItem(LS_SYNCED);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<SyncedRec>;
    if (!r || typeof r.entryId !== "string" || typeof r.note !== "string") return null;
    return { entryId: r.entryId, note: r.note };
  } catch {
    return null;
  }
}

// Entries whose JobTread note this page has read (or that it opened itself).
const heard = new Set<string>();
let syncedMem: SyncedRec | null = null;

/** What this device last knew JobTread to hold for this entry, or null. */
export function syncedNoteFor(entryId: string): string | null {
  if (!entryId) return null;
  const r = syncedMem ?? readSyncedRec();
  return r && r.entryId === entryId ? r.note : null;
}

/** JobTread holds `note` for this entry — read just now, or saved just now. */
export function markNoteSynced(entryId: string, note: string) {
  if (!entryId) return;
  heard.add(entryId);
  syncedMem = { entryId, note };
  try {
    localStorage.setItem(LS_SYNCED, JSON.stringify(syncedMem));
  } catch {}
}

let pending: { entryId: string; note: string } | null = null;
let timer: number | null = null;
let chain: Promise<void> = Promise.resolve();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNoteSave();
  });
  window.addEventListener("pagehide", () => flushNoteSave());
}

/**
 * The box changed. Save it to JobTread 2 s from now, unless more typing comes
 * first. Nothing is sent for text JobTread already holds, for a preview clock
 * (no entry id), or for an entry this page has not heard JobTread on yet.
 */
export function queueNoteSave(entryId: string, note: string) {
  if (typeof window === "undefined") return;
  listen();
  const synced = syncedNoteFor(entryId);
  if (!entryId || !heard.has(entryId) || (synced !== null && sameNote(note, synced))) {
    // Back to what JobTread holds: a save still waiting is no longer needed.
    if (pending && pending.entryId === entryId) cancelTimer();
    return;
  }
  pending = { entryId, note };
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(flushNoteSave, DEBOUNCE_MS);
}

function cancelTimer() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  pending = null;
}

/** Send a waiting save now — the box lost focus, or the page is going away. */
export function flushNoteSave() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  const job = pending;
  pending = null;
  if (!job) return;
  // One save at a time, in order, so an older text never lands last.
  chain = chain.then(() => send(job));
}

/**
 * The entry is closing (clock out, switch, break). Those calls carry the note
 * themselves, so drop any save still waiting for it.
 */
export function dropNoteSave(entryId: string) {
  if (pending && (!entryId || pending.entryId === entryId)) cancelTimer();
}

async function send(job: { entryId: string; note: string }) {
  const synced = syncedNoteFor(job.entryId);
  if (synced !== null && sameNote(job.note, synced)) return;
  try {
    const res = await fetch("/api/employee-time/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "note", entryId: job.entryId, note: job.note }),
      keepalive: true, // finishes even when the tab is closing
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; previewed?: boolean };
    if (res.ok && j.ok !== false && !j.previewed) markNoteSynced(job.entryId, job.note);
  } catch {
    /* offline: the note stays in this device's storage, and the next keystroke
       or the clock-out sends it */
  }
}
