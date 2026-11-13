"use client";

import { useAccess } from "@/components/AccessProvider";
import { Menu, MenuLink } from "@/components/Menu";
import { PageTitle, PeakMark } from "@/components/PageTitle";

const PAGES = [
  { view: "tools", href: "/tools", label: "Tools" },
  { view: "tool-schedule", href: "/tool-schedule", label: "Tool Schedule" },
  { view: "requisitions", href: "/requisitions", label: "Requisitions" },
];

/**
 * The page title is a menu to the other pages of the Tools group, at every
 * width. On a phone it replaces the pill row (WorkspaceTabs hides on these
 * pages below `pad`); from `pad` up the pills show too. `current` is the
 * page's own view id; the menu lists the others this person can open.
 */
export function ToolsTitleMenu({ current }: { current: "tools" | "tool-schedule" | "requisitions" }) {
  const access = useAccess();
  const title = PAGES.find((p) => p.view === current)!.label;
  const items = PAGES.filter((p) => p.view !== current && access.can(p.view));

  if (items.length === 0) return <PageTitle>{title}</PageTitle>;
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className="flex min-h-10 min-w-0 items-center gap-2.5">
          <PeakMark className="h-3.5 w-[22px] shrink-0" />
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <span aria-hidden className="text-xs text-neutral-500">
            ▾
          </span>
        </button>
      }
    >
      {items.map((i) => (
        <MenuLink key={i.view} href={i.href}>
          <span className="font-semibold">{i.label}</span>
        </MenuLink>
      ))}
    </Menu>
  );
}
