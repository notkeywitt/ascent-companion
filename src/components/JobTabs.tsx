"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { Tabs, btn } from "@/components/ui";

/**
 * ONE JOB, ITS PAGES — the tab row that ties a job's pages together
 * (CONSOLIDATION_PLAN.md stage 4). Pick the job once; every tab opens on it
 * through ?jobId. Each tab keeps its own route and gate, and shows only to
 * someone who holds its view. "This month" hands over to Tracking Sheets.
 */
const TABS = [
  { view: "job-board", href: "/job-board/", label: "Overview" },
  { view: "clients", href: "/clients", label: "Record" },
  { view: "jobs", href: "/jobs", label: "Job Cost" },
  { view: "budget-import", href: "/budget-import", label: "Budget Import" },
  { view: "specs", href: "/specs", label: "Specifications" },
  { view: "house-manual", href: "/house-manual", label: "House Manual" },
  { view: "unbilled", href: "/unbilled", label: "Unbilled" },
  { view: "recode", href: "/trackingsheet", label: "This month" },
];

export function JobTabs({ jobId, className = "" }: { jobId: string; className?: string }) {
  const { can } = useAccess();
  const pathname = usePathname();
  if (!jobId) return null;
  return (
    <Tabs
      label="This job"
      className={className}
      items={TABS.filter((t) => can(t.view)).map((t) => {
        const page = t.href.endsWith("/");
        return {
          key: t.href,
          label: t.label,
          href: page ? `${t.href}${encodeURIComponent(jobId)}` : `${t.href}?jobId=${encodeURIComponent(jobId)}`,
          active: page ? pathname === `${t.href}${jobId}` : pathname === t.href,
        };
      })}
    />
  );
}

/**
 * The same pages as buttons, for the Jobs page's job card (owner, 2026-11-02).
 * Overview and "This month" stay off: the job's name opens the Overview, and
 * the card's own Tracking sheet tab is this month.
 */
export function JobPageLinks({ jobId, className = "" }: { jobId: string; className?: string }) {
  const { can } = useAccess();
  const links = TABS.filter((t) => !t.href.endsWith("/") && t.view !== "recode" && can(t.view));
  if (!jobId || links.length === 0) return null;
  return (
    <nav aria-label="This job's pages" className={`flex flex-wrap gap-1.5 ${className}`}>
      {links.map((t) => (
        <Link
          key={t.href}
          href={`${t.href}?jobId=${encodeURIComponent(jobId)}`}
          className={btn("secondary", "xs")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
