"use client";

/**
 * A panel that slides in over the page: a bottom sheet on a phone, a side panel
 * from the right at `pad` (744px) and up. Built on Base UI's Drawer, which
 * owns the swipe, focus trap, scroll lock, Escape and the portal.
 *
 * On a phone it opens at half height and drags up to full (`expandable`), or
 * opens at its content height (`expandable={false}`). A swipe down past the
 * lowest height closes it. Use `Dialog` for a question that needs an answer;
 * use `Sheet` for a place the user browses (a menu, a filter set, a detail).
 */

import { useEffect, useState } from "react";
import { Drawer } from "@base-ui/react/drawer";

// Matches the `pad` screen in tailwind.config.ts.
const WIDE = "(min-width: 744px)";
const SNAPS = [0.5, 1];

// Read on the first render, not in an effect: Base UI warns when snap points
// change after the drawer starts. A closed sheet renders no markup, so the
// server's guess cannot mismatch.
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function Sheet({
  open,
  onClose,
  title,
  label,
  footer,
  expandable = true,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** The accessible name when there is no string `title`. */
  label?: string;
  footer?: React.ReactNode;
  /** Phone only: open at half height and drag to full. */
  expandable?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const wide = useWide();
  const snaps = !wide && expandable;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => !next && onClose()}
      swipeDirection={wide ? "right" : "down"}
      snapPoints={snaps ? SNAPS : undefined}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 print:hidden" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center pad:items-stretch pad:justify-end print:hidden">
          <Drawer.Popup
            aria-label={label ?? (typeof title === "string" ? title : undefined)}
            className={`flex w-full flex-col border-line bg-white text-neutral-900 shadow-xl outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[swiping]:select-none data-[swiping]:duration-0 dark:bg-ink-overlay dark:text-neutral-100 ${
              wide
                ? "h-full max-w-md border-l [transform:translateX(var(--drawer-swipe-movement-x,0px))] data-[ending-style]:[transform:translateX(100%)] data-[starting-style]:[transform:translateX(100%)]"
                : // With snap points the popup is full height, pushed down by the
                  // offset; the bottom padding lifts the footer back into view.
                  `${snaps ? "h-[calc(100dvh-1rem)] [padding-bottom:max(0px,calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]" : "max-h-[90dvh]"} rounded-t-2xl border-t [transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))] data-[ending-style]:[transform:translateY(100%)] data-[starting-style]:[transform:translateY(100%)]`
            } ${className}`}
          >
            {!wide && (
              <div className="flex shrink-0 touch-none justify-center pb-1 pt-2.5" aria-hidden>
                <div className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
              </div>
            )}
            {title && (
              <Drawer.Title className="shrink-0 px-4 pb-2 pt-3 text-base font-semibold leading-snug pad:pt-4">
                {title}
              </Drawer.Title>
            )}
            <Drawer.Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {children}
            </Drawer.Content>
            {footer && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-soft px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
                {footer}
              </div>
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
