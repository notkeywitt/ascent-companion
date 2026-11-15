"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LINE_FAST_CYCLE_MS, LoadingScreen, msToEraseEnd } from "@/components/LoadingScreen";
import { isLeaveCancelled } from "@/lib/useUnsavedChanges";

/** Drop the cover after this long, so an abandoned navigation can't strand it. */
const MAX_MS = 8000;
/** Fade of the empty ground once the line has erased. */
const FADE_MS = 150;

/**
 * The page-transition cover: the same loading-line screen, shown from the tap
 * on an in-app link until the next page renders.
 *
 * Why this exists next to `src/app/loading.tsx`: that file is the App Router's
 * Suspense fallback, and it only paints on a HARD load (a typed URL, a refresh,
 * a cold PWA start). On an in-app tap React runs the navigation as a
 * transition, which by design keeps the current page on screen and never falls
 * back — so the route file alone would never cover a tap. This listens for the
 * tap instead.
 *
 * It reads the pending navigation from the DOM click, and clears it when
 * `usePathname()` reports the new route has committed. The cover itself fades
 * in only after 400ms (see `.loading-screen-in`), so the many navigations that
 * finish sooner than the eye show nothing but the tapped button's own spinner.
 *
 * Whole or nothing: the line runs at double speed (`fast`). If the page lands
 * before the line starts, the cover goes at once and nothing was seen. If the
 * line has started, the cover stays until it finishes its erase, then fades.
 * So the screen never shows a snip of the line.
 *
 * The listener runs in the CAPTURE phase on purpose: `<Link>` calls
 * `preventDefault()` in its own handler, so a bubble-phase listener sees every
 * real in-app navigation as already cancelled and never fires.
 */
export function RouteLoadingScreen() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"off" | "on" | "fading">("off");
  const ref = useRef<HTMLDivElement>(null);

  // The new route rendered — this is the real "done" signal.
  useEffect(() => {
    setPending(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Left click only, no modifier (those open a tab, not this page).
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      // Off-site, a download, or a same-page hash/query change — no page swap.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      // Decide once the click has run every listener: an unsaved-changes guard
      // further down may cancel it, and Cancel means stay put, not a cover.
      setTimeout(() => {
        if (!isLeaveCancelled(event)) setPending(true);
      }, 0);
    }
    // Browser back/forward restores a cached page at once — nothing to cover,
    // and the pathname effect above may not fire if the route is unchanged.
    function onPopState() {
      setPending(false);
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const bail = setTimeout(() => setPending(false), MAX_MS);
    return () => clearTimeout(bail);
  }, [pending]);

  // Show while pending. When the wait ends, let the line finish its stroke.
  useEffect(() => {
    if (pending) {
      setPhase("on");
      return;
    }
    const wait = msToEraseEnd(ref.current, LINE_FAST_CYCLE_MS);
    if (wait === null) {
      setPhase("off"); // the line never started: nothing was seen
      return;
    }
    const fade = setTimeout(() => setPhase("fading"), wait);
    const end = setTimeout(() => setPhase("off"), wait + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, [pending]);

  if (phase === "off") return null;
  return (
    // The fade sits on this wrapper: the cover's own opacity belongs to its
    // fade-in animation, which would override a class set on it.
    <div
      ref={ref}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      className={`pointer-events-none fixed inset-0 z-[100] transition-opacity ease-out ${
        phase === "fading" ? "opacity-0" : "opacity-100"
      }`}
    >
      <LoadingScreen delayed fast />
    </div>
  );
}
