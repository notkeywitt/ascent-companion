"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";

/**
 * A small tab row joining pages that are ONE menu row (CONSOLIDATION_PLAN.md
 * stage 6): Audit = System Logs · Financial Journal; Look & Text = Page Text ·
 * Theme; Help = Help · What's new. Each tab keeps its own route and gate and
 * shows only to someone who holds its view; with one or none, the row hides.
 */
export interface PageTab {
  view: string;
  href: string;
  label: string;
}

export const AUDIT_TABS: PageTab[] = [
  { view: "logs", href: "/logs", label: "System Logs" },
  { view: "journal", href: "/journal", label: "Financial Journal" },
];
export const LOOK_TABS: PageTab[] = [
  { view: "page-copy", href: "/admin/copy", label: "Page Text" },
  { view: "theme-editor", href: "/theme", label: "Theme" },
];
export const HELP_TABS: PageTab[] = [
  { view: "help", href: "/help", label: "Help" },
  { view: "changelog", href: "/changelog", label: "What's new" },
];

export function PageTabs({ tabs, className = "" }: { tabs: PageTab[]; className?: string }) {
  const { can } = useAccess();
  const pathname = usePathname();
  const shown = tabs.filter((t) => can(t.view));
  if (shown.length < 2) return null;
  return (
    <nav className={`mb-4 flex gap-1 border-b border-line ${className}`}>
      {shown.map((t) => {
        const here = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={here ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold transition ${
              here
                ? "border-accent text-accent"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
