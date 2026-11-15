"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The id of the title area in the header (AppHeader). Phones only. */
export const HEADER_TITLE_SLOT = "app-title-slot";

/**
 * Puts a page's title in the header bar on a phone (below `pad`). From `pad`
 * up the slot is hidden and the page draws its own heading.
 *
 * A page that renders nothing here still gets a title: AppHeader falls back to
 * the page's name in `lib/workspaces`. The fallback hides while this is mounted.
 * `PageTitle` renders this, so every `PageHeader` title lands in the bar.
 */
export function HeaderTitle({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const find = () => {
      const el = document.getElementById(HEADER_TITLE_SLOT);
      if (el) setSlot(el);
      else if (tries++ < 20) timer = setTimeout(find, 100);
    };
    find();
    return () => clearTimeout(timer);
  }, []);
  if (!slot) return null;
  return createPortal(
    <h1 className="truncate text-[17px] font-bold leading-tight tracking-tight">{children}</h1>,
    slot,
  );
}
