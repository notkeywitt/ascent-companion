"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Tabs } from "@/components/ui";

/**
 * The Invoicing hub's sibling pages — Tracking Sheets · Checks · Status
 * (CONSOLIDATION_PLAN.md stage 2), drawn with the one `Tabs` style above the
 * page title. The month (?ym) rides along; pass `ym` so a page opened on its
 * default month still hands that month on.
 */
const TABS = [
  { view: "recode", href: "/trackingsheet", label: "Tracking Sheets" },
  { view: "invoice-review", href: "/invoice-review", label: "Checks" },
  { view: "invoicing-summary", href: "/invoicing-summary", label: "Status" },
];

export function InvoicingTabs({ className = "", ym: shown = "" }: { className?: string; ym?: string }) {
  const { can } = useAccess();
  const pathname = usePathname();
  const fromUrl = useSearchParams().get("ym") ?? "";
  const ym = shown || fromUrl;
  return (
    <Tabs
      label="Invoicing"
      className={className}
      items={TABS.filter((t) => can(t.view)).map((t) => ({
        key: t.href,
        label: t.label,
        href: ym ? `${t.href}?ym=${encodeURIComponent(ym)}` : t.href,
        active: pathname === t.href || pathname.startsWith(t.href + "/"),
      }))}
    />
  );
}
