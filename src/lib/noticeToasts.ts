/**
 * Desktop alerts for notices — the OS toast in the corner of the screen.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. This is the browser's own Notification
 * API, which only works while the Assistant is OPEN in a tab or the Chrome
 * side panel. It needs no service worker, no VAPID keys and no server: the page
 * asks the OS to draw a toast. Nothing arrives when the app is closed — that
 * is Web Push, a separate build (see the notes in `.claude/sessions/`).
 *
 * A toast fires only for a notice that arrives while the app is in the
 * BACKGROUND. If the reader is looking at the app, the banner under the header
 * is already saying it, and a toast on top of it is the same sentence twice.
 * `planToasts` is that whole rule, kept pure so it can be tested.
 *
 * Two per-device values in localStorage, like the theme and the palette:
 *  - `notices.desktopAlerts` — the reader's own on/off choice for THIS computer
 *  - `notices.toasted`       — the notice ids this device has already handled,
 *                              so a reload cannot toast the same notice twice
 *
 * iPhones and iPads have no `Notification` constructor at all (Safari needs a
 * service worker and a push subscription even inside an installed PWA), so
 * every entry point here is guarded and the settings card hides itself when
 * `toastsSupported()` is false.
 */

export const TOAST_PREF_KEY = "notices.desktopAlerts";
export const TOASTED_KEY = "notices.toasted";

/** How many ids the ledger keeps. Enough that a reload can't re-toast. */
export const TOASTED_CAP = 60;
/** A burst of new notices toasts at most this many, so the corner never fills. */
export const TOAST_BURST_CAP = 3;

/** What the control can say about this device. */
export type ToastState =
  /** No Notification API (every iPhone, and older browsers). */
  | "unsupported"
  /** Available, and the reader has not turned it on here. */
  | "off"
  /** The reader turned it on but the browser has not been asked yet. */
  | "ask"
  /** The browser is refusing — only the reader can undo this, in site settings. */
  | "blocked"
  /** Armed. */
  | "on";

/* ------------------------------------------------------------------ the rule */

/**
 * Which of the notices in the feed should toast, and what the ledger becomes.
 *
 * PURE — no window, no storage, no clock. Every id the feed returns lands in
 * the ledger whether it toasted or not: a notice the reader has already met as
 * a banner must not toast later just because they switched tabs.
 */
export function planToasts({
  feed,
  toasted,
  hidden,
  enabled,
  cap = TOAST_BURST_CAP,
  ledgerCap = TOASTED_CAP,
}: {
  /** Notice ids in the reader's current feed, newest first. */
  feed: number[];
  /** Ids this device has already accounted for. */
  toasted: number[];
  /** Is the app in the background right now? */
  hidden: boolean;
  /** Has the reader turned desktop alerts on for this device? */
  enabled: boolean;
  cap?: number;
  ledgerCap?: number;
}): { toast: number[]; ledger: number[] } {
  const seen = new Set(toasted);
  const fresh = feed.filter((id) => !seen.has(id));
  return {
    toast: enabled && hidden ? fresh.slice(0, cap) : [],
    ledger: mergeToasted(toasted, feed, ledgerCap),
  };
}

/** The ledger after accounting for `ids` — de-duplicated, newest last, capped. */
export function mergeToasted(
  existing: number[],
  ids: number[],
  cap = TOASTED_CAP,
): number[] {
  const merged = [...existing.filter((id) => !ids.includes(id)), ...ids];
  return merged.slice(Math.max(0, merged.length - cap));
}

/* ------------------------------------------------------- device-side plumbing */

export function toastsSupported(): boolean {
  return typeof window !== "undefined" && typeof window.Notification === "function";
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private window, or storage blocked
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice just won't persist */
  }
}

export function readToastPref(): boolean {
  return readStorage(TOAST_PREF_KEY) === "1";
}

export function writeToastPref(on: boolean): void {
  writeStorage(TOAST_PREF_KEY, on ? "1" : "0");
}

export function readToasted(): number[] {
  try {
    const parsed = JSON.parse(readStorage(TOASTED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function writeToasted(ids: number[]): void {
  writeStorage(TOASTED_KEY, JSON.stringify(ids));
}

/** What the settings card shows, and what `planToasts` is handed as `enabled`. */
export function toastState(): ToastState {
  if (!toastsSupported()) return "unsupported";
  if (!readToastPref()) return "off";
  const permission = window.Notification.permission;
  if (permission === "denied") return "blocked";
  if (permission === "granted") return "on";
  return "ask";
}

/**
 * Turn alerts on for this device. The browser only accepts the prompt from a
 * real click, so this must be called straight out of an event handler.
 */
export async function enableToasts(): Promise<ToastState> {
  if (!toastsSupported()) return "unsupported";
  writeToastPref(true);
  try {
    const permission = await window.Notification.requestPermission();
    if (permission === "granted") return "on";
    return permission === "denied" ? "blocked" : "ask";
  } catch {
    return "blocked";
  }
}

export function disableToasts(): void {
  writeToastPref(false);
}

/**
 * Draw one toast. `tag` is the notice's own id, so two open tabs (or a tab and
 * the side panel) collapse into ONE toast instead of stacking. Clicking it
 * brings the app forward.
 */
export function showToast(notice: { id: number | string; title: string; body?: string }): boolean {
  if (!toastsSupported() || window.Notification.permission !== "granted") return false;
  try {
    const toast = new window.Notification(notice.title, {
      body: notice.body || undefined,
      icon: "/icon-192.png",
      tag: `ascent-notice-${notice.id}`,
    });
    toast.onclick = () => {
      try {
        window.focus();
        toast.close();
      } catch {
        /* nothing to do if the browser refuses focus */
      }
    };
    return true;
  } catch {
    // Some browsers throw here rather than returning a permission state.
    return false;
  }
}
