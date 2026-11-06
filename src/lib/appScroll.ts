/**
 * Which element scrolls the page.
 *
 * In a browser tab the WINDOW scrolls, as usual. In the installed app (Home
 * Screen PWA) `#app-shell` scrolls instead and the window never moves
 * (globals.css, the `display-mode: standalone` block). Reason: iPhone's
 * Home Screen apps drag a `position: fixed` bar along with a scrolling
 * document (WebKit bug 297779). JobTread's own app shows the same drift. A
 * document that never scrolls gives the tab bar nothing to ride along with.
 *
 * So any code that reads or sets the page's scroll goes through here, never
 * `window.scrollY` / `window.scrollTo` directly — those read 0 and do nothing
 * in the installed app.
 *
 * Locking the page under a sheet is unchanged: set `document.body.style.overflow
 * = "hidden"`. The standalone block in globals.css carries that lock to
 * `#app-shell`.
 */

export const APP_SCROLL_ID = "app-shell";

/** The element that scrolls the page: `#app-shell` in the installed app, else the document. */
export function appScroller(): HTMLElement {
  const shell = document.getElementById(APP_SCROLL_ID);
  if (shell) {
    const y = getComputedStyle(shell).overflowY;
    if (y === "auto" || y === "scroll") return shell;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** True when `#app-shell`, not the window, scrolls the page. */
export function appScrollsInShell(): boolean {
  return appScroller().id === APP_SCROLL_ID;
}

/** The page's scroll offset from the top. */
export function appScrollY(): number {
  return appScroller().scrollTop;
}

export function appScrollTo(top: number): void {
  appScroller().scrollTo({ top });
}

export function appScrollBy(dy: number): void {
  appScroller().scrollBy({ top: dy });
}

/**
 * Call `fn` whenever the page scrolls, whichever element scrolls it. Returns
 * the unsubscribe. A scroll event on an element does not reach a plain
 * window listener, so this listens on both.
 */
export function onAppScroll(fn: () => void): () => void {
  const shell = document.getElementById(APP_SCROLL_ID);
  window.addEventListener("scroll", fn, { passive: true });
  shell?.addEventListener("scroll", fn, { passive: true });
  return () => {
    window.removeEventListener("scroll", fn);
    shell?.removeEventListener("scroll", fn);
  };
}
