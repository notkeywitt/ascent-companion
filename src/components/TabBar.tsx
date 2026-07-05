"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Top-level sections. Add more here as the companion grows.
const TABS: { label: string; href: string; match: (p: string) => boolean }[] = [
  {
    label: "Billing",
    href: "/",
    match: (p) => p === "/" || p.startsWith("/unbilled") || p.startsWith("/bill"),
  },
  { label: "RFIs", href: "/rfis", match: (p) => p.startsWith("/rfis") },
  { label: "Requests", href: "/requests", match: (p) => p.startsWith("/requests") },
];

export function TabBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const jobId = search.get("jobId") ?? "";
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  if (pathname === "/login") return null;

  return (
    <nav className="sticky top-0 z-10 flex gap-1 border-b border-neutral-200 bg-[#faf8f4]/90 px-3 backdrop-blur dark:border-neutral-800 dark:bg-[#1b2024]/90">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href + qs}
            className={
              "border-b-2 px-3 py-2.5 text-sm font-semibold transition " +
              (active
                ? "border-accent text-accent"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
