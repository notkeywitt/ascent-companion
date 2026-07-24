"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SyncNowButton } from "@/components/SyncNowButton";
import { useAccess } from "@/components/AccessProvider";

/**
 * The header's utility row. It used to carry the nav tabs (Coding Review /
 * Invoicing / More); navigation now lives entirely on the home launcher
 * (src/app/page.tsx), so all that's left here is Sync + the theme toggle.
 * Sync is gated on the "sync" view, which is admin-only — see lib/views.
 */

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
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="mr-2 rounded-md px-2 py-1 text-sm text-neutral-500 transition hover:text-accent dark:hover:text-accent-soft"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const access = useAccess();

  if (pathname === "/login" || pathname === "/privacy") return null;

  return (
    <nav className="flex items-center justify-end pb-1 pr-1">
      {access.can("sync") && <SyncNowButton />}
      <ThemeToggle />
    </nav>
  );
}
