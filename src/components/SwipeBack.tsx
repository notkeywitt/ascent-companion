"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SWIPE_THRESHOLD, swipeArmed, swipeStarts } from "@/lib/swipeBack";

/**
 * Swipe right from the screen's left edge to go back. It replaced the header's
 * back button.
 *
 * Only in the installed app (home-screen PWA). A browser tab already has its
 * own back gesture, and running both would go back twice.
 *
 * Home has nowhere to go back to, so it does nothing there. A page opened cold
 * (a shared link) has no history, so the swipe goes home instead.
 *
 * A swipe does not start on a field, a canvas (the signature pad), a dialog or
 * an element marked `data-no-swipe`.
 */
export function SwipeBack() {
  const router = useRouter();
  const pathname = usePathname();
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const live = useRef({ dx: 0, dy: 0 });
  const home = pathname === "/";

  useEffect(() => {
    if (home) return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    function blocked(target: EventTarget | null): boolean {
      const el = target instanceof Element ? target : null;
      return !!el?.closest(
        "input, textarea, select, canvas, [contenteditable], [role='dialog'], [data-no-swipe]",
      );
    }

    function reset() {
      start.current = null;
      live.current = { dx: 0, dy: 0 };
      setDx(0);
    }

    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !swipeStarts(t.clientX) || blocked(e.target)) {
        start.current = null;
        return;
      }
      start.current = { x: t.clientX, y: t.clientY };
    }

    function onMove(e: TouchEvent) {
      const s = start.current;
      if (!s) return;
      const moveX = e.touches[0].clientX - s.x;
      const moveY = e.touches[0].clientY - s.y;
      // A clearly vertical start is a scroll, not a swipe.
      if (Math.abs(moveY) > 12 && Math.abs(moveY) > moveX) {
        reset();
        return;
      }
      live.current = { dx: moveX, dy: moveY };
      setDx(Math.max(0, moveX));
    }

    function onEnd() {
      if (!start.current) return;
      const { dx: endX, dy: endY } = live.current;
      reset();
      if (!swipeArmed(endX, endY)) return;
      if (window.history.length > 1) router.back();
      else router.push("/");
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [home, router]);

  if (dx === 0) return null;

  const travel = Math.min(SWIPE_THRESHOLD, dx * 0.6);
  const armed = swipeArmed(live.current.dx, live.current.dy);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-1/2 z-[60] -translate-y-1/2"
      style={{ left: `${travel - 40}px` }}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-lg shadow-md dark:bg-ink-raised ${
          armed ? "text-accent" : "text-neutral-500 dark:text-neutral-400"
        }`}
        style={{ opacity: Math.min(1, travel / SWIPE_THRESHOLD) }}
      >
        ←
      </div>
    </div>
  );
}
