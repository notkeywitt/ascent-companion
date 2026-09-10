"use client";

import { useEffect, useState } from "react";

import { ListCard, ListRow, SectionHeading, SectionLabel } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { usePagesMenu } from "@/components/NavLayoutProvider";
import { PagesMenuEditor } from "@/components/PagesMenuEditor";

/**
 * ALL PAGES — one collapsible menu at the bottom of the home page listing every
 * page in the app, grouped by function.
 *
 * It replaced the Admin Actions bar (deleted 2026-09-10), which was three
 * script-job buttons and a Tracking Sheets shortcut. Those runs still live on
 * /actions, which is where a script job belongs; what the bottom of the home
 * page is for is FINDING a page. The launcher above shows each menu's first
 * three rows, and the office's tile launcher shows four buttons — so "where is
 * that page again" had no complete answer anywhere until here.
 *
 * OFFICE + ADMIN only, and each row is still gated on its own view id, so a
 * page an office account cannot open never renders.
 *
 * Collapsed by default and remembered per device: a forty-row menu open every
 * time you land on Home is the launcher's job, not this one's.
 *
 * The order and grouping are the ADMIN'S — Edit menu writes them to
 * /api/admin/pages-menu (see src/lib/pagesMenu.ts for what a saved layout does
 * and does not decide).
 */

/** Where the menu remembers whether you left it open. */
const OPEN_KEY = "home.allPages.open";

export function AllPagesMenu({ qs = "" }: { qs?: string }) {
  const access = useAccess();
  const { groups, isCustom } = usePagesMenu();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  // Read in an effect, not in the initial state: this page is server-rendered
  // too, and a first render that read `window` would disagree with the HTML.
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* private mode — start closed */
    }
  }, []);

  const toggle = () => {
    setOpen((was) => {
      const next = !was;
      try {
        localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        /* nothing to do — the fold still works for this visit */
      }
      return next;
    });
  };

  // Only what this user can reach, and no heading over an empty group.
  const visible = groups
    .map((g) => ({ ...g, pages: g.pages.filter((p) => access.can(p.view)) }))
    .filter((g) => g.pages.length > 0);

  if (visible.length === 0) return null;
  const total = visible.reduce((n, g) => n + g.pages.length, 0);

  return (
    <section className="mt-6">
      <SectionHeading
        onToggle={toggle}
        open={open}
        trailing={<span className="text-[11px] tabular-nums text-neutral-500">{total}</span>}
      >
        All Pages
      </SectionHeading>

      {open &&
        (editing ? (
          <div className="mt-2">
            <PagesMenuEditor onClose={() => setEditing(false)} />
          </div>
        ) : (
          <>
            {/* Newspaper columns, not a grid — same reason as the launcher's:
                a grid locks every group to the height of the tallest one in its
                row, and these run from two rows to fifteen. */}
            <div className="mt-2 pad:columns-2 pad:gap-6 xl:columns-3">
              {visible.map((group) => (
                // `mb-5` rather than a container gap: a multi-column flow has no
                // "between siblings" to hang one on once a column breaks.
                <div key={group.id} className="mb-5 space-y-1.5 break-inside-avoid">
                  <SectionLabel>{group.title}</SectionLabel>
                  <ListCard>
                    {group.pages.map((p) => (
                      <ListRow key={p.view} href={p.href + qs} label={p.label} desc={p.desc} />
                    ))}
                  </ListCard>
                </div>
              ))}
            </div>

            {access.role === "admin" && (
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-[11px] font-semibold text-accent hover:underline dark:text-accent-soft"
                >
                  Edit menu
                </button>
                {isCustom && (
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Custom order
                  </span>
                )}
              </div>
            )}
          </>
        ))}
    </section>
  );
}
