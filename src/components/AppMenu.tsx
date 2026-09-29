"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { ListCard, ListRow, SectionLabel, btn } from "@/components/ui";
import { EXTRA_LINKS, TODAY, WORKSPACES, locate, reachableTabs, type WorkspaceTab } from "@/lib/workspaces";

/**
 * The header's ☰ menu — every page this person can open, by workspace, from
 * any page, for every role at every width. It replaced the desktop-only side
 * drawer, the home launchers, "The Rest" (/more) and All Pages (2026-09-29):
 * one list (src/lib/workspaces.ts), one menu.
 *
 * The current workspace opens at the top, so the next step of a job is one tap.
 * The footer carries the pages that belong to no workspace (the Assistant,
 * LopezRocks) and the account.
 *
 * THE DRAWER IS PORTALLED TO <body>, and has to be. It is mounted from inside
 * the header, and the header carries `backdrop-blur` — a filtered element is
 * the containing block for every `position: fixed` descendant, so the overlay
 * would size itself to the header instead of the window.
 */

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

export function AppMenu({ qs = "" }: { qs?: string }) {
  const access = useAccess();
  const c = useCopy();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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

  const here = locate(pathname)?.workspace.id;
  const workspaces = WORKSPACES.map((w) => ({ ...w, tabs: reachableTabs(w, access.can) }))
    .filter((w) => w.tabs.length > 0)
    .sort((a, b) => Number(b.id === here) - Number(a.id === here));
  const extras = EXTRA_LINKS.filter((t) => access.can(t.view));
  const row = (t: WorkspaceTab) => (
    <ListRow
      key={t.href}
      href={t.href + qs}
      label={c(`home.dest.${t.view}.label`) || t.label}
      desc={c(`home.dest.${t.view}.desc`) || t.desc}
      className={pathname === t.href ? "bg-accent/5" : ""}
    />
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        aria-expanded={open}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:text-accent active:bg-accent/10"
      >
        <MenuIcon />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-40 print:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <aside
              aria-label="Menu"
              className="sidenav-in absolute inset-y-0 left-0 flex w-[min(340px,88vw)] flex-col border-r border-line bg-cream shadow-xl dark:bg-ink"
            >
              <div className="flex items-center gap-3 border-b border-line px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
                <span className="flex-1 text-sm font-semibold tracking-tight">Menu</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="text-lg leading-none text-neutral-500 transition hover:text-accent"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <ListCard>{row(TODAY)}</ListCard>

                {workspaces.map((w) => (
                  <div key={w.id} className="space-y-1.5">
                    <SectionLabel>{w.title}</SectionLabel>
                    <ListCard>{w.tabs.map(row)}</ListCard>
                  </div>
                ))}

                {extras.length > 0 && (
                  <div className="space-y-1.5">
                    <SectionLabel>More</SectionLabel>
                    <ListCard>{extras.map(row)}</ListCard>
                  </div>
                )}

                <div className="border-t border-line pt-4 text-center">
                  <p className="text-xs text-neutral-500">
                    Signed in — access level: <span className="font-semibold">{access.role}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className={btn("secondary", "md", "mt-3")}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
