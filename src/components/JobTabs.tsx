"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";

/**
 * ONE JOB, ITS PAGES — the tab row that ties a job's pages together
 * (CONSOLIDATION_PLAN.md stage 4). Pick the job once; every tab opens on it
 * through ?jobId. Each tab keeps its own route and gate, and shows only to
 * someone who holds its view. "This month" hands over to Tracking Sheets.
 */
const TABS = [
  { view: "clients", href: "/clients", label: "Record" },
  { view: "jobs", href: "/jobs", label: "Cost" },
  { view: "budget-import", href: "/budget-import", label: "Budget Import" },
  { view: "specs", href: "/specs", label: "Specs" },
  { view: "unbilled", href: "/unbilled", label: "Unbilled" },
  { view: "recode", href: "/trackingsheet", label: "This month" },
];

export function JobTabs({ jobId, className = "" }: { jobId: string; className?: string }) {
  const { can } = useAccess();
  const pathname = usePathname();
  if (!jobId) return null;
  const tabs = TABS.filter((t) => can(t.view));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="This job" className={`mb-4 -mx-4 overflow-x-auto px-4 ${className}`}>
      <div className="flex w-max gap-1 border-b border-line">
        {tabs.map((t) => {
          const here = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={`${t.href}?jobId=${encodeURIComponent(jobId)}`}
              aria-current={here ? "page" : undefined}
              className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition ${
                here
                  ? "border-accent text-accent"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
