"use client";

import { useCallback, useRef, type ReactNode } from "react";

/**
 * The bar that carries a page's commit action (Sync, Save, Post) and pins
 * itself to the bottom of the screen while there is something to commit.
 *
 * It sits ABOVE the tab bar via `--tabbar-h` (see globals.css) rather than a
 * hardcoded offset, so the two can never overlap and neither has to know the
 * other's height. Show it only when there IS a staged change — a permanently
 * docked bar spends the screen's most valuable strip on a disabled button.
 *
 * IT PUBLISHES ITS OWN HEIGHT as `--actionbar-h`, the same way AppHeader
 * publishes `--appheader-h`, because a height-capped panel beside it has to
 * end ABOVE it and cannot guess: the bar is `flex-wrap`, so it is one row or
 * two depending on the page, the width and the browser's font size. Guessing
 * is what left the coding card's Filing block under this bar. `.max-h-below-
 * header` reads the published number. Unmounting resets it to 0px — the bar
 * only exists while something is staged.
 *
 * A callback ref, not an effect: this component mounts and unmounts as staged
 * work appears and clears, which is exactly when the value must change.
 */
export function StickyActionBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      document.documentElement.style.setProperty("--actionbar-h", "0px");
      return;
    }
    if (typeof ResizeObserver === "undefined") return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--actionbar-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    observer.current = ro;
  }, []);

  return (
    <div
      ref={measure}
      className={`sticky z-10 -mx-4 flex items-center gap-2 border-t border-line bg-cream/95 px-4 py-2.5 backdrop-blur dark:bg-ink/95 print:hidden ${className}`}
      style={{ bottom: "var(--tabbar-h, 0px)" }}
    >
      {children}
    </div>
  );
}
