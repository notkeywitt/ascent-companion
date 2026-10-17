"use client";

import { useEffect, useRef, useState } from "react";
import { PULL_THRESHOLD, pullArmed, pullDistance } from "@/lib/pullToRefresh";

/**
 * Pull down from the top of any page to reload it.
 *
 * Only in the installed app (home-screen PWA). A browser tab already has its
 * own pull-to-refresh, and running both would reload twice.
 *
 * It reloads the whole page rather than calling `router.refresh()`: most pages
 * fetch their data in a client effect, which a router refresh does not re-run.
 *
 * A pull does not start when:
 *   - the page is scrolled down, or the touch is inside a box that is;
 *   - the touch is on a field, a canvas (the signature pad) or a dialog;
 *   - a sheet has locked the page scroll (body overflow hidden);
 *   - the finger moves sideways first (a chip scroller, a swipe).
 * Add `data-no-pull` to any element that must never start one.
 */
export function PullToRefresh() {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number; pulling: boolean } | null>(null);
  const distanceRef = useRef(0);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    function blocked(target: EventTarget | null): boolean {
      if (window.scrollY > 0) return true;
      if (document.body.style.overflow === "hidden") return true;
      const el = target instanceof Element ? target : null;
      if (!el) return false;
      if (
        el.closest(
          "input, textarea, select, canvas, [contenteditable], [role='dialog'], [data-no-pull]",
        )
      )
        return true;
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (node.scrollTop > 0) return true;
      }
      return false;
    }

    function set(d: number) {
      distanceRef.current = d;
      setDistance(d);
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1 || blocked(e.target)) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, pulling: false };
    }

    function onMove(e: TouchEvent) {
      const s = start.current;
      if (!s) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.pulling) {
        // Wait for a clear direction. Sideways or upward first → not a pull.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          start.current = null;
          return;
        }
        s.pulling = true;
      }
      set(pullDistance(dy));
    }

    function onEnd() {
      const s = start.current;
      start.current = null;
      if (!s?.pulling) return;
      if (pullArmed(distanceRef.current)) {
        setRefreshing(true);
        window.location.reload();
      } else {
        set(0);
      }
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (distance === 0 && !refreshing) return null;

  const armed = refreshing || pullArmed(distance);
  const travel = refreshing ? PULL_THRESHOLD : distance;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-1/2 z-[60] -translate-x-1/2"
      style={{ top: `calc(env(safe-area-inset-top) + ${travel - 40}px)` }}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white shadow-md dark:bg-ink-raised ${
          armed ? "text-accent" : "text-neutral-500 dark:text-neutral-400"
        }`}
        style={{ opacity: Math.min(1, travel / PULL_THRESHOLD) }}
      >
        {refreshing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none">
            <path
              d="M12 3a9 9 0 1 0 9 9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          // A down arrow that turns to point up once a release would reload.
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 transition-transform duration-150"
            style={{ transform: armed ? "rotate(180deg)" : undefined }}
            fill="none"
          >
            <path
              d="M12 5v14M6 13l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
