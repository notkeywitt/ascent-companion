"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { PageTitle, PeakMark } from "@/components/PageTitle";

const PAGES = [
  { view: "tools", href: "/tools", label: "Tools" },
  { view: "tool-schedule", href: "/tool-schedule", label: "Tool Schedule" },
  { view: "requisitions", href: "/requisitions", label: "Requisitions" },
];

/**
 * Phone only: the page title is a menu to the other pages of the Tools group.
 * It replaces the pill row (WorkspaceTabs hides on these pages below `pad`).
 * From `pad` up the pills return and the title is plain. `current` is the
 * page's own view id; the menu lists the others this person can open.
 */
export function ToolsTitleMenu({ current }: { current: "tools" | "tool-schedule" | "requisitions" }) {
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const title = PAGES.find((p) => p.view === current)!.label;
  const items = PAGES.filter((p) => p.view !== current && access.can(p.view));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <>
      <PageTitle className="min-w-0 max-pad:hidden">{title}</PageTitle>
      <div
        ref={ref}
        className="relative min-w-0 pad:hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {items.length === 0 ? (
          <PageTitle>{title}</PageTitle>
        ) : (
          <>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="flex min-h-10 items-center gap-2.5"
            >
              <PeakMark className="h-3.5 w-[22px] shrink-0" />
              <h1 className="text-xl font-bold tracking-tight">{title}</h1>
              <span aria-hidden className="text-xs text-neutral-500">
                ▾
              </span>
            </button>
            {open && (
              <div
                role="menu"
                className="absolute left-0 z-30 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-1 shadow-xl shadow-black/10 dark:bg-ink-overlay dark:shadow-black/40"
              >
                {items.map((i) => (
                  <Link
                    key={i.view}
                    role="menuitem"
                    href={i.href}
                    className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-neutral-100 dark:hover:bg-white/[0.07]"
                  >
                    {i.label}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
