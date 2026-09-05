"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LoadingScreen } from "@/components/LoadingScreen";

/** Drop the cover after this long, so an abandoned navigation can't strand it. */
const MAX_MS = 8000;

/**
 * The page-transition cover: the same logo-on-black screen, shown from the tap
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
 * in only after 180ms (see `.loading-screen-in`), so the many navigations that
 * finish sooner than the eye show nothing but the tapped button's own spinner.
 *
 * The listener runs in the CAPTURE phase on purpose: `<Link>` calls
 * `preventDefault()` in its own handler, so a bubble-phase listener sees every
 * real in-app navigation as already cancelled and never fires.
 */
export function RouteLoadingScreen() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

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
      setPending(true);
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

  if (!pending) return null;
  return <LoadingScreen delayed />;
}
