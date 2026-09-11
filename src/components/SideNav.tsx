"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { usePagesMenu } from "@/components/NavLayoutProvider";
import { LinkPendingOverlay } from "@/components/LinkPending";
import { ListCard, ListRow, SectionLabel } from "@/components/ui";
import type { PageEntry } from "@/lib/pagesMenu";

/**
 * The DESKTOP slide-out menu — every page in the app, one click from wherever
 * you are, plus the handful each person pins to the top.
 *
 * WHY IT EXISTS. The complete page list is the All Pages menu, and that menu
 * lives at the bottom of Home: reaching any page from another page costs a trip
 * to Home first. On a phone that is fine — the tab bar carries the pages opened
 * all day and the launcher is one tap. At a desk it is two navigations to open
 * a page a sidebar could show without leaving the one you are on.
 *
 * It is the SAME catalog as All Pages (usePagesMenu → src/lib/pagesMenu.ts), so
 * the admin's saved order and grouping apply here too and a page added to the
 * app appears in both the day it is added. Each row is gated on its own view id
 * on top of that, exactly as the launcher and the middleware gate it.
 *
 * OFFICE + ADMIN only, and only from `xl` up — the toggle is hidden below that
 * width, where the tab bar and the launcher are the right controls.
 *
 * PINNED is PER DEVICE, in localStorage: no server round trip, nothing to save,
 * and the person customizing a desktop sidebar is at that desktop.
 * ponytail: per-device pins; move to a `nav_layout`-style per-user row if
 * someone wants the same pins on a second computer.
 */

/** Where the pinned view ids live. */
const PINS_KEY = "sidenav.pins";

const MenuIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    className="h-5 w-5"
    aria-hidden
  >
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export function SideNav({ qs = "" }: { qs?: string }) {
  const access = useAccess();
  const { groups } = usePagesMenu();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pins, setPins] = useState<string[]>([]);

  // Read in an effect, not in the initial state: the header is server-rendered,
  // and a first render that read `window` would disagree with the HTML.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      if (raw) setPins(JSON.parse(raw));
    } catch {
      /* private mode, or an older shape — start with nothing pinned */
    }
  }, []);

  // A menu whose whole job is to navigate has to close when it does.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (access.role !== "admin" && access.role !== "office") return null;

  // Only what this user can reach, and no heading over an empty group.
  const visible = groups
    .map((g) => ({ ...g, pages: g.pages.filter((p) => access.can(p.view)) }))
    .filter((g) => g.pages.length > 0);
  const byView = new Map(visible.flatMap((g) => g.pages.map((p) => [p.view, p] as const)));
  // A pin for a page that was renamed, retired, or gated away is dropped here
  // rather than rendered as a dead tile.
  const pinned = pins.map((v) => byView.get(v)).filter((p): p is PageEntry => !!p);

  const togglePin = (view: string) =>
    setPins((prev) => {
      const next = prev.includes(view) ? prev.filter((v) => v !== view) : [...prev, view];
      try {
        localStorage.setItem(PINS_KEY, JSON.stringify(next));
      } catch {
        /* nothing to do — the pin still holds for this visit */
      }
      return next;
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="All pages"
        aria-expanded={open}
        className="hidden shrink-0 items-center rounded-lg p-2 text-neutral-500 transition hover:text-accent xl:inline-flex"
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 print:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside
            aria-label="All pages"
            className="sidenav-in absolute inset-y-0 left-0 flex w-[330px] flex-col border-r border-line bg-cream shadow-xl dark:bg-ink"
          >
            <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
              <span className="flex-1 text-sm font-semibold tracking-tight">All Pages</span>
              <button
                type="button"
                onClick={() => setEditing((was) => !was)}
                className="text-[11px] font-semibold text-accent hover:underline dark:text-accent-soft"
              >
                {editing ? "Done" : "Edit"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="text-lg leading-none text-neutral-500 transition hover:text-accent"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
              {editing && (
                <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  Tap a page to pin it to the top of this menu. This device only.
                </p>
              )}

              {pinned.length > 0 && !editing && (
                <div className="grid grid-cols-2 gap-2">
                  {pinned.map((p) => (
                    <Link
                      key={p.view}
                      href={p.href + qs}
                      className="relative flex min-h-[56px] flex-col justify-center rounded-xl border border-line bg-white px-3 py-2 text-center text-sm font-semibold tracking-tight transition hover:border-accent hover:bg-accent/5 dark:bg-ink-raised"
                    >
                      {p.label}
                      <LinkPendingOverlay spinnerClassName="h-5 w-5" />
                    </Link>
                  ))}
                </div>
              )}

              {visible.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  <SectionLabel>{group.title}</SectionLabel>
                  <ListCard>
                    {group.pages.map((p) =>
                      editing ? (
                        <ListRow
                          key={p.view}
                          onClick={() => togglePin(p.view)}
                          label={p.label}
                          chevron={false}
                          trailing={
                            <span
                              aria-hidden
                              className={`shrink-0 text-sm ${
                                pins.includes(p.view)
                                  ? "text-accent dark:text-accent-soft"
                                  : "text-neutral-400 dark:text-neutral-500"
                              }`}
                            >
                              {pins.includes(p.view) ? "★" : "☆"}
                            </span>
                          }
                        />
                      ) : (
                        <ListRow key={p.view} href={p.href + qs} label={p.label} />
                      ),
                    )}
                  </ListCard>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
