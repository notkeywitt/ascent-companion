"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SyncNowButton } from "@/components/SyncNowButton";

type Tab = { label: string; href: string; match: (p: string) => boolean };

// Coding Review and Invoicing stay as standalone tabs; everything else lives
// in the "More" dropdown so the bar fits the phone / side-panel widths.
const PRIMARY_TABS: Tab[] = [
  {
    label: "Coding Review",
    href: "/",
    match: (p) =>
      p === "/" || p.startsWith("/unbilled") || p.startsWith("/bill") || p.startsWith("/add-bill"),
  },
  { label: "Invoicing", href: "/stage", match: (p) => p.startsWith("/stage") },
];

const MORE_TABS: Tab[] = [
  { label: "Email", href: "/email", match: (p) => p.startsWith("/email") },
  { label: "Needs Project", href: "/needs-project", match: (p) => p.startsWith("/needs-project") },
  { label: "Labor", href: "/labor-import", match: (p) => p.startsWith("/labor-import") },
  { label: "Safety Meeting", href: "/safety-meeting", match: (p) => p.startsWith("/safety-meeting") },
  { label: "Employees", href: "/employees", match: (p) => p.startsWith("/employees") },
  { label: "RFIs", href: "/rfis", match: (p) => p.startsWith("/rfis") },
  { label: "Requests", href: "/requests", match: (p) => p.startsWith("/requests") },
  { label: "Admin", href: "/admin", match: (p) => p.startsWith("/admin") },
  { label: "Logs", href: "/logs", match: (p) => p.startsWith("/logs") },
];

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  }
  return (
    <button
      onClick={toggle}
      title="Toggle light/dark"
      aria-label="Toggle light/dark"
      className="mr-2 rounded-md px-2 py-1 text-sm text-neutral-500 hover:text-accent"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

/** Dropdown holding the secondary tabs. Reads as a tab; when one of its pages
 *  is active the trigger takes that page's label and the accent underline. */
function MoreMenu({ pathname, qs }: { pathname: string; qs: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Close when navigation lands on a new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const activeTab = MORE_TABS.find((t) => t.match(pathname));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition " +
          (activeTab
            ? "border-accent text-accent"
            : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")
        }
      >
        {activeTab ? activeTab.label : "More"}
        <span
          className={
            "text-xs transition-transform " + (open ? "rotate-180 " : "") + (activeTab ? "" : "text-neutral-400")
          }
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-neutral-300 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {MORE_TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                role="menuitem"
                href={t.href + qs}
                onClick={() => setOpen(false)}
                className={
                  "flex items-center justify-between px-3 py-2 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 " +
                  (active ? "font-semibold text-accent" : "text-neutral-700 dark:text-neutral-300")
                }
              >
                {t.label}
                {active && <span aria-hidden>✓</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const jobId = search.get("jobId") ?? "";
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  if (pathname === "/login" || pathname === "/privacy") return null;

  return (
    <nav className="flex items-center pr-1">
      {/* No overflow-x-auto here: it would clip the dropdown, and the three
          remaining items fit even side-panel widths. */}
      <div className="flex flex-1 items-center gap-1 px-2">
        {PRIMARY_TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href + qs}
              className={
                "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition " +
                (active
                  ? "border-accent text-accent"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")
              }
            >
              {t.label}
            </Link>
          );
        })}
        <MoreMenu pathname={pathname} qs={qs} />
      </div>
      <SyncNowButton />
      <ThemeToggle />
    </nav>
  );
}
