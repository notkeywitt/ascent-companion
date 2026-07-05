"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const TABS: { label: string; href: string; match: (p: string) => boolean }[] = [
  {
    label: "Billing",
    href: "/",
    match: (p) => p === "/" || p.startsWith("/unbilled") || p.startsWith("/bill"),
  },
  { label: "RFIs", href: "/rfis", match: (p) => p.startsWith("/rfis") },
  { label: "Requests", href: "/requests", match: (p) => p.startsWith("/requests") },
  { label: "Admin", href: "/admin", match: (p) => p.startsWith("/admin") },
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

export function TabBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const jobId = search.get("jobId") ?? "";
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  if (pathname === "/login") return null;

  return (
    <nav className="sticky top-0 z-10 flex items-center border-b border-black/10 bg-[#FAF7EE]/90 pr-1 backdrop-blur dark:border-white/10 dark:bg-[#1B1B17]/90">
      <div className="flex flex-1 gap-1 overflow-x-auto px-2">
        {TABS.map((t) => {
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
      </div>
      <ThemeToggle />
    </nav>
  );
}
