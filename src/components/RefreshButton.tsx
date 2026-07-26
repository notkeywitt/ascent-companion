"use client";

import { useRef, useState } from "react";
import { useRefresh } from "@/components/RefreshProvider";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";

/**
 * Header button that reloads the data on whatever page you're on — re-runs the
 * page's /api fetches (via RefreshProvider) without a full-page reload.
 *
 * Distinct from Sync: Sync kicks off the backend JobTread→Sheets/Drive mirror
 * (a ~15-min job); this just pulls the latest into the view you're looking at.
 * Guarded by the unsaved-changes prompt so it can't silently wipe a bill you're
 * mid-edit on (a remount resets page state, same as leaving would).
 */
export function RefreshButton() {
  const { refresh } = useRefresh();
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onClick() {
    // Remounting the page resets its local state, so honor the same guard the
    // job picker uses before it navigates away from an unsaved bill.
    if (!confirmLeaveIfDirty()) return;
    refresh();
    // The client re-fetches happen on remount and aren't awaitable from here, so
    // spin briefly just to register the tap.
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBusy(false), 700);
  }

  return (
    <button
      onClick={onClick}
      title="Reload this page's data"
      aria-label="Reload this page's data"
      className="shrink-0 rounded-md px-2 py-1 text-neutral-500 transition hover:text-accent dark:hover:text-accent-soft"
    >
      {/* Two-arrow refresh (feather refresh-cw), on the app's 24×24 / 2px line
          grid — deliberately unlike Sync's ⟳ text glyph so the two don't blur. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={"h-4 w-4" + (busy ? " animate-spin" : "")}
        aria-hidden
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  );
}
