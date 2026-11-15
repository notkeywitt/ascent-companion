"use client";

import { useAccess } from "@/components/AccessProvider";
import { Tabs } from "@/components/ui";

const PAGES = [
  { view: "tools", href: "/tools", label: "Tools" },
  { view: "tool-schedule", href: "/tool-schedule", label: "Tool Schedule" },
  { view: "requisitions", href: "/requisitions", label: "Requisitions" },
] as const;

export type ToolsPage = (typeof PAGES)[number]["view"];

/** The page's own name, for its `PageHeader` title (the header bar on a phone). */
export function toolsTitle(current: ToolsPage): string {
  return PAGES.find((p) => p.view === current)!.label;
}

/**
 * A tab bar joining the pages of the Tools group, at every width. It replaced
 * the title drop-down. Each tab shows only to someone who holds its view; with
 * one tab, the row hides (`Tabs` hides under two).
 */
export function ToolsTabs({ current }: { current: ToolsPage }) {
  const { can } = useAccess();
  return (
    <Tabs
      label="Tools pages"
      items={PAGES.filter((p) => p.view === current || can(p.view)).map((p) => ({
        key: p.view,
        label: p.label,
        href: p.href,
        active: p.view === current,
      }))}
    />
  );
}
