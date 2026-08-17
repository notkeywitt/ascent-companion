"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Course reading progress, persisted in the browser (localStorage) on THIS
 * device. There is no server-side course-progress store — the companion DB has
 * no table for it — so progress does not sync across devices. That is a
 * deliberate scope choice: for a course read on one phone it is enough, and it
 * keeps this feature to zero new API surface. (If cross-device is ever wanted,
 * back this with a per-user row instead of localStorage — the hook's shape can
 * stay the same.)
 *
 * Two numbers per segment, because they answer different questions:
 *   pos = the FURTHEST point reached (0..1) — drives the % shown on the syllabus.
 *   at  = where you actually STOPPED (0..1) — drives the "resume" jump, so
 *         scrolling back to re-read something doesn't move your bookmark forward.
 * `ts` timestamps the last change so a stale tab can't clobber a fresher one.
 */

const KEY = "ascent-course-v1";

interface Progress {
  done: number[];
  pos: Record<number, number>;
  at: Record<number, number>;
  last: number | null;
  ts: number;
}

function blank(): Progress {
  return { done: [], pos: {}, at: {}, last: null, ts: 0 };
}

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw) as Partial<Progress>;
    return {
      done: Array.isArray(s.done) ? s.done.filter((n) => typeof n === "number") : [],
      pos: s.pos && typeof s.pos === "object" ? s.pos : {},
      at: s.at && typeof s.at === "object" ? s.at : {},
      last: typeof s.last === "number" ? s.last : null,
      ts: typeof s.ts === "number" ? s.ts : 0,
    };
  } catch {
    return blank();
  }
}

/**
 * Merge `next` over whatever is currently on disk rather than overwriting it, so
 * a second tab (or an earlier visit) can't wipe progress it never saw:
 * completion is a union, `pos` keeps the furthest either side reached, and the
 * more recently touched record owns "where you stopped".
 */
function write(next: Progress): Progress {
  try {
    const prev = read();
    const done = next.done.slice();
    for (const n of prev.done) if (!done.includes(n)) done.push(n);
    const pos: Record<number, number> = {};
    for (const src of [prev.pos, next.pos]) {
      for (const k of Object.keys(src)) {
        const key = Number(k);
        pos[key] = Math.max(pos[key] ?? 0, src[key] ?? 0);
      }
    }
    const merged: Progress = { ...next, done, pos };
    if (prev.ts > next.ts) {
      merged.at = prev.at;
      merged.last = prev.last;
      merged.ts = prev.ts;
    }
    localStorage.setItem(KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return next;
  }
}

export interface CourseProgress {
  /** True once localStorage has been read (post-mount). Gate first-paint UI on this. */
  hydrated: boolean;
  done: number[];
  last: number | null;
  isDone: (n: number) => boolean;
  /** Furthest fraction reached in segment n (0..1). */
  posOf: (n: number) => number;
  /** Where reading stopped in segment n (0..1). */
  atOf: (n: number) => number;
  markDone: (n: number) => void;
  /** Record a live scroll position for segment n (fraction 0..1). */
  recordScroll: (n: number, fraction: number) => void;
  /** Note that segment n was opened (sets `last`), without moving the bookmark. */
  touch: (n: number) => void;
  reset: () => void;
}

export function useCourseProgress(): CourseProgress {
  const [state, setState] = useState<Progress>(blank);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load once on mount (localStorage is browser-only, so never during SSR).
  useEffect(() => {
    setState(read());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Progress, immediate = false) => {
    setState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const flush = () => setState(write(next));
    if (immediate) flush();
    else saveTimer.current = setTimeout(flush, 400);
  }, []);

  // Flush pending writes when the tab is genuinely hidden or torn down.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      write(stateRef.current);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      // On unmount (e.g. leaving the reader for the syllabus) CANCEL any pending
      // debounced write rather than letting it fire. The App Router scrolls the
      // window to the top as it navigates away, which lands one last scroll event
      // at fraction 0; flushing that would overwrite the reader's real bookmark.
      // Dropping the pending write keeps the last committed position instead.
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const isDone = useCallback((n: number) => stateRef.current.done.includes(n), []);
  const posOf = useCallback((n: number) => stateRef.current.pos[n] ?? 0, []);
  const atOf = useCallback((n: number) => stateRef.current.at[n] ?? 0, []);

  const markDone = useCallback(
    (n: number) => {
      const s = stateRef.current;
      const done = s.done.includes(n) ? s.done : [...s.done, n];
      persist({ ...s, done, pos: { ...s.pos, [n]: 1 }, at: { ...s.at, [n]: 1 }, last: n, ts: Date.now() }, true);
    },
    [persist],
  );

  const recordScroll = useCallback(
    (n: number, fraction: number) => {
      const f = Math.min(1, Math.max(0, fraction));
      const s = stateRef.current;
      // Ignore sub-pixel jitter so we don't thrash writes.
      if (Math.abs((s.at[n] ?? 0) - f) < 0.004 && s.last === n) return;
      persist({
        ...s,
        pos: { ...s.pos, [n]: Math.max(s.pos[n] ?? 0, f) },
        at: { ...s.at, [n]: f },
        last: n,
        ts: Date.now(),
      });
    },
    [persist],
  );

  const touch = useCallback(
    (n: number) => {
      const s = stateRef.current;
      if (s.last === n) return;
      persist({ ...s, last: n, ts: Date.now() }, true);
    },
    [persist],
  );

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setState(blank());
  }, []);

  return {
    hydrated,
    done: state.done,
    last: state.last,
    isDone,
    posOf,
    atOf,
    markDone,
    recordScroll,
    touch,
    reset,
  };
}
