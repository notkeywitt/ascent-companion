"use client";

import { useEffect } from "react";

// Module-level flag so components that navigate PROGRAMMATICALLY (e.g. the
// global JobPicker's router.replace, which isn't an interceptable anchor click)
// can ask whether it's safe to leave. useUnsavedChanges() keeps this in step
// with the calling page's unsaved-edit state.
let guardActive = false;

const DEFAULT_MESSAGE =
  "You have unsaved changes on this bill. Leave without saving? Your changes will be lost.";

/**
 * Returns true if it's safe to navigate away; otherwise prompts and returns the
 * user's choice. Call this from programmatic navigators (router.push/replace),
 * which don't emit an anchor click for useUnsavedChanges to intercept:
 *
 *   if (!confirmLeaveIfDirty()) return;
 *   router.replace(...);
 */
export function confirmLeaveIfDirty(message = DEFAULT_MESSAGE): boolean {
  if (!guardActive || typeof window === "undefined") return true;
  return window.confirm(message);
}

/**
 * Warn before leaving the current page while `dirty` is true. Covers every way
 * off the page:
 *   - refresh / tab close / external URL / hard nav → native beforeunload dialog
 *   - in-app <Link> clicks (tabs, header, prev/next, back-to-queue) → confirm
 *   - browser / mobile Back & Forward                 → confirm
 * Programmatic router navigations should additionally call confirmLeaveIfDirty().
 */
export function useUnsavedChanges(dirty: boolean, message = DEFAULT_MESSAGE) {
  // Mirror `dirty` into the shared flag so confirmLeaveIfDirty() sees live state.
  useEffect(() => {
    guardActive = dirty;
    return () => {
      guardActive = false;
    };
  }, [dirty]);

  // 1. Browser-level leave: refresh, tab/window close, typing a new URL, or any
  //    hard navigation. Shows the browser's native "Leave site?" dialog.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // required by some browsers to trigger the prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 2. In-app navigation. Next's <Link> renders an <a>; catching the click in
  //    the capture phase lets us confirm before the router acts. On cancel we
  //    block the click (preventDefault marks it handled, so <Link> bails too);
  //    on confirm we let it proceed as normal.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab / download — let through
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return; // no-op / in-page anchor
      if (a.target && a.target !== "_self") return; // opens in another context
      if (window.confirm(message)) return; // OK → allow the navigation
      e.preventDefault();
      e.stopImmediatePropagation(); // block the router before it sees the click
    };
    document.addEventListener("click", onClick, true); // capture phase
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, message]);

  // 3. Browser / mobile Back & Forward. beforeunload does NOT fire for in-app
  //    history navigation, so guard it with a sentinel entry: on Back the pop
  //    lands here (same URL), we confirm, and on cancel we re-push the sentinel
  //    so the page stays put.
  useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      if (window.confirm(message)) {
        // Leave: stop guarding, then step back past the page.
        window.removeEventListener("popstate", onPopState);
        window.history.back();
      } else {
        // Stay: re-add the sentinel (pushState doesn't fire popstate).
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [dirty, message]);
}
