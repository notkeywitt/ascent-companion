"use client";

import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Tabs } from "@/components/ui";

/**
 * A HUB's tab row (the page folds, owner, 2026-11-27): every page of a hub draws
 * it at the top, so the ☰ menu needs only the hub's MENU_ROWS
 * (src/lib/workspaces.ts). Each tab is its own route and keeps its own view
 * gate; a tab shows only to someone who holds its view, and the row hides with
 * fewer than two. `also` lists other routes that light the tab: the pages its
 * own small tab row (PageTabs) joins.
 */
interface HubTab {
  view: string;
  href: string;
  label: string;
  also?: string[];
}

export const HUBS = {
  admin: [
    { view: "admin", href: "/admin", label: "Access" },
    { view: "skins", href: "/admin/skins", label: "Skins" },
    { view: "ascentbot", href: "/ascentbot", label: "AscentBot" },
    { view: "page-copy", href: "/admin/copy", label: "Look & Text", also: ["/theme"] },
    { view: "logs", href: "/logs", label: "Audit", also: ["/journal", "/ai-cost", "/admin/activity"] },
    { view: "ai-scripts", href: "/ai-scripts", label: "AI Scripts" },
    { view: "historical-cost", href: "/historical-cost", label: "Historical Cost" },
    { view: "art", href: "/art", label: "Art" },
  ],
  // People (2026-11-28). Time Off (/time-off) stays out: it is each person's
  // own request page; the office approves leave in Payroll's Time off section.
  people: [
    { view: "employees", href: "/employees", label: "Employees" },
    { view: "new-hires", href: "/onboarding/office", label: "New Hires" },
    { view: "labor-rates", href: "/labor-rates", label: "Pay Rates" },
    { view: "time-sync", href: "/payroll", label: "Payroll" },
  ],
  // Find (2026-11-28).
  find: [
    { view: "bill-search", href: "/bill-search", label: "Bill Search" },
    { view: "vendors", href: "/vendors", label: "Vendors" },
    { view: "expenditure-history", href: "/expenditure-history", label: "Bill Archive" },
    { view: "vendor-mail", href: "/vendor-mail/index", label: "Vendor Addresses" },
  ],
} satisfies Record<string, HubTab[]>;

export function HubTabs({ hub }: { hub: keyof typeof HUBS }) {
  const { can } = useAccess();
  const pathname = usePathname();
  const tabs: HubTab[] = HUBS[hub];
  return (
    <Tabs
      label="Pages"
      className="mb-3"
      items={tabs
        .filter((t) => can(t.view))
        .map((t) => ({
          key: t.href,
          label: t.label,
          href: t.href,
          active: pathname === t.href || !!t.also?.includes(pathname),
        }))}
    />
  );
}
