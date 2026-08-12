"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * The admin-notice popup — an announcement an admin pushed (Admin → Notices)
 * shown as a modal on whatever page the reader has open, the same "find you where
 * you are" mechanism as the unmatched-vendor alert (StuckVendors.tsx).
 *
 * Self-contained: it fetches its own feed (/api/notices, which the server scopes
 * to this signed-in user and filters out anything they've already dismissed) and
 * has no context provider because nothing else consumes it. Notices show one at a
 * time, newest first; acknowledging one records the read server-side (so it stays
 * gone across devices and sessions) and advances to the next.
 *
 * Mounted once in the root layout, only for signed-in users.
 */

interface Notice {
  id: number;
  title: string;
  body: string;
  tone: "info" | "warning" | "success" | string;
  createdAt: string;
}

const TONE_STYLE: Record<string, { badge: string; icon: ReactNode }> = {
  info: {
    badge: "bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent-soft",
    icon: (
      <path d="M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
    ),
  },
  warning: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    icon: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
  },
  success: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    icon: (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="m9 11 3 3L22 4" />
      </>
    ),
  },
};

export function NoticePopup() {
  const [queue, setQueue] = useState<Notice[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/notices")
      .then((r) => r.json())
      .then((j) => {
        if (alive && Array.isArray(j.notices)) setQueue(j.notices);
      })
      // A failed fetch must never break the page it's mounted on — the popup is
      // additive. Stay silent and show nothing.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const current = queue[0];

  const dismiss = useCallback(() => {
    if (!current) return;
    const id = current.id;
    // Advance immediately; record the read in the background.
    setQueue((q) => q.slice(1));
    fetch("/api/notices/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, [current]);

  // Escape closes the current notice, matching the backdrop click.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  if (!current) return null;

  const tone = TONE_STYLE[current.tone] ?? TONE_STYLE.info;
  const remaining = queue.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={dismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="notice-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:bg-ink-raised"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.badge}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              {tone.icon}
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="notice-title" className="text-base font-bold tracking-tight">
              {current.title}
            </h2>
            {current.body && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-500">{current.body}</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">
            {remaining > 0 ? `${remaining} more notice${remaining === 1 ? "" : "s"}` : ""}
          </span>
          <Button onClick={dismiss}>{remaining > 0 ? "Next" : "Got it"}</Button>
        </div>
      </div>
    </div>
  );
}
