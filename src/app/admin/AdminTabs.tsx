"use client";

import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Tabs } from "@/components/ui";

/**
 * THE ADMIN HUB's tab row (owner, 2026-11-27). Every Admin page draws it at the
 * top of its page, so the ☰ menu needs one Admin row (plus Skins, at the
 * owner's ask). Each tab is its own route and keeps its own view gate; a tab
 * shows only to someone who holds its view. `also` lists the routes that light
 * the tab: the pages its own small tab row (PageTabs) joins.
 */
const ADMIN_TABS: { view: string; href: string; label: string; also?: string[] }[] = [
  { view: "admin", href: "/admin", label: "Access" },
  { view: "skins", href: "/admin/skins", label: "Skins" },
  { view: "ascentbot", href: "/ascentbot", label: "AscentBot" },
  { view: "page-copy", href: "/admin/copy", label: "Look & Text", also: ["/theme"] },
  { view: "logs", href: "/logs", label: "Audit", also: ["/journal", "/ai-cost", "/admin/activity"] },
  { view: "ai-scripts", href: "/ai-scripts", label: "AI Scripts" },
  { view: "historical-cost", href: "/historical-cost", label: "Historical Cost" },
  { view: "art", href: "/art", label: "Art" },
];

export function AdminTabs() {
  const { can } = useAccess();
  const pathname = usePathname();
  return (
    <Tabs
      label="Admin pages"
      className="mb-3"
      items={ADMIN_TABS.filter((t) => can(t.view)).map((t) => ({
        key: t.href,
        label: t.label,
        href: t.href,
        active: pathname === t.href || !!t.also?.includes(pathname),
      }))}
    />
  );
}
