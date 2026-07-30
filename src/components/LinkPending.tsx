"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui";

/**
 * Tap→loading feedback for a Next <Link>. Drop as the LAST child of a
 * `position: relative` <Link>; while THAT link's navigation is in flight it lays
 * a brand ring + centered spinner over the button, so a tap always looks like it
 * registered — the button reads as "selected, now loading" — before the next
 * page paints. Backed by Next's useLinkStatus, so it reflects the REAL pending
 * navigation, not merely the moment of the press, and clears itself the instant
 * the destination renders.
 *
 * Requirements on the parent <Link>:
 *   • `relative` (the overlay is absolutely positioned to inset-0), and
 *   • a `rounded-*` class (the overlay inherits its corner radius).
 */
export function LinkPendingOverlay({
  spinnerClassName = "h-5 w-5",
}: {
  spinnerClassName?: string;
}) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-accent/10 ring-2 ring-inset ring-accent dark:bg-accent/20 dark:ring-accent-soft"
    >
      <Spinner className={spinnerClassName} />
    </span>
  );
}
