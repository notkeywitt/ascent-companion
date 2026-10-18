"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";

/**
 * The Invoicing hub's three tabs — Tracking Sheets · Checks · Package
 * (CONSOLIDATION_PLAN.md, stage 2). The month (?ym) rides along, so a month
 * picked on one tab is the month on the next. Each tab shows only to someone
 * who holds its view; with one or none, the row hides.
 */
const TABS = [
  { view: "recode", href: "/trackingsheet", label: "Tracking Sheets" },
  { view: "invoice-review", href: "/invoice-review", label: "Checks" },
  { view: "invoicing-summary", href: "/invoicing-summary", label: "Package" },
];

export function InvoicingTabs({ className = "" }: { className?: string }) {
  const { can } = useAccess();
  const pathname = usePathname();
  const ym = useSearchParams().get("ym") ?? "";
  const tabs = TABS.filter((t) => can(t.view));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Invoicing" className={`mb-4 flex gap-1 border-b border-line ${className}`}>
      {tabs.map((t) => {
        const here = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={ym ? `${t.href}?ym=${encodeURIComponent(ym)}` : t.href}
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
