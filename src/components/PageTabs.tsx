"use client";

import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Tabs } from "@/components/ui";

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
  return (
    <Tabs
      label="Pages"
      className={className}
      items={tabs.filter((t) => can(t.view)).map((t) => ({ key: t.href, label: t.label, href: t.href, active: pathname === t.href }))}
    />
  );
}
