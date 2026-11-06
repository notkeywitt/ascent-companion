"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { APP_SCROLL_ID, appScroller, appScrollsInShell } from "@/lib/appScroll";

/**
 * Page-to-page scroll for the installed app, where `#app-shell` scrolls and
 * the window does not (src/lib/appScroll.ts says why).
 *
 * The browser and Next.js both expect the WINDOW to scroll, so two things
 * break without this:
 *   - A new page opens at the old page's scroll offset. Next's own reset sets
 *     the window's scroll, which does nothing here, and then scrolls the new
 *     page's top under the sticky header. This puts a new page at the top.
 *   - Back no longer returns to where you were. The browser only restores the
 *     window's scroll. This saves each page's offset and puts it back.
 *
 * Renders nothing. In a browser tab it does nothing at all.
 */
// Module state, not refs: the keeper sits under a Suspense boundary that can
// remount it on a navigation, and a remount must not forget where you were.
const saved = new Map<string, number>(); // each page's offset, by path + query
let shownKey: string | null = null; // the page the saved offsets belong to
let shownPath: string | null = null;
let lastY = 0; // the offset at the last scroll event, i.e. before a navigation
let poppedTo: string | null = null; // where the last back or forward went
let listening = false;

function keyOfLocation(): string {
  const q = new URLSearchParams(window.location.search).toString();
  return q ? `${window.location.pathname}?${q}` : window.location.pathname;
}

function listen(shell: HTMLElement) {
  if (listening) return;
  listening = true;
  let lastH = shell.scrollHeight;
  shell.addEventListener(
    "scroll",
    () => {
      lastY = shell.scrollTop;
      // A navigation swaps in a shorter page (the loading screen first, then
      // the new page), and the browser clamps the offset to fit. That is not
      // the person scrolling, so it must not overwrite where they were. Save
      // only while the address still names the page in view, and never on a
      // scroll the page shrinking caused.
      const shrank = shell.scrollHeight < lastH - 1;
      lastH = shell.scrollHeight;
      const here = keyOfLocation();
      if (!shrank && here === shownKey) saved.set(here, shell.scrollTop);
    },
    { passive: true },
  );
  // Capture, so this runs before Next's own popstate handler renders the page
  // (WebKit and Chromium fire a target's capture listeners first). If it
  // runs after anyway, the late check in the effect below still catches it.
  window.addEventListener(
    "popstate",
    () => {
      const to = keyOfLocation();
      poppedTo = to;
      window.setTimeout(() => {
        if (poppedTo === to) poppedTo = null;
      }, 1000);
    },
    { capture: true },
  );
}

export function AppScrollKeeper() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    const shell = document.getElementById(APP_SCROLL_ID);
    if (shell) listen(shell);
  }, []);

  useEffect(() => {
    if (shownKey === null) {
      shownKey = key;
      shownPath = pathname;
      return;
    }
    if (shownKey === key) return;
    const newPage = shownPath !== pathname;
    shownKey = key;
    shownPath = pathname;
    if (!appScrollsInShell()) return;
    const shell = appScroller();

    // Back or forward: put the page back where it was. Most pages fetch their
    // rows after they render, so keep trying for a moment while the page grows
    // tall enough — and stop the moment the person touches the screen.
    const restore = () => {
      poppedTo = null;
      const y = saved.get(key) ?? 0;
      let stop = false;
      const cancel = () => (stop = true);
      window.addEventListener("touchstart", cancel, { once: true, passive: true });
      const until = Date.now() + 1500;
      const step = () => {
        if (stop) return;
        shell.scrollTop = y;
        if (Math.abs(shell.scrollTop - y) > 1 && Date.now() < until) requestAnimationFrame(step);
        else window.removeEventListener("touchstart", cancel);
      };
      step();
    };
    if (poppedTo === key) return restore();
    window.setTimeout(() => {
      if (poppedTo === key) restore();
    }, 0);

    // A new page starts at the top.
    if (newPage) {
      shell.scrollTop = 0;
      return;
    }

    // Same page, new query. If Next moved the scroll, it meant "go to the
    // top" — but it lands the page under the header, so finish the job. A
    // scroll pinned at the bottom is the page getting shorter, not Next:
    // leave that one where the browser put it.
    const moved = Math.abs(shell.scrollTop - lastY) > 1;
    const atBottom = shell.scrollTop >= shell.scrollHeight - shell.clientHeight - 1;
    if (moved && !atBottom) shell.scrollTop = 0;
  }, [key, pathname]);

  return null;
}
