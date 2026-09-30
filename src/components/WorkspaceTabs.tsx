"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { ChipScroller } from "@/components/ui";
import { carryJobAndMonth } from "@/lib/urlParam";
import { confirmLeaveIfDirty } from "@/lib/useUnsavedChanges";
import { NO_STRIP, locate, reachableTabs } from "@/lib/workspaces";

/**
 * The workspace's tabs, one row under the header — the next step of the job
 * one tap away (Tracking Sheets → Labor Review → … → Finalize).
 *
 * Every tab carries the page's `jobId` and `ym`, so the job and the month travel
 * with the person instead of being picked again on each page. A page puts `ym`
 * in the address only when the person picks a month (src/lib/urlParam.ts), so
 * until then each tab opens on its own default month.
 *
 * Rendered once, in the root layout: it finds the workspace from the path, so
 * no page has to mount it. Hidden on a page that is on no workspace, on a
 * workspace this person can open only one tab of, on NO_STRIP pages, and from
 * 2xl up, where the sidebar lists the same tabs.
 *
 * Never shown to FIELD or LEAD (owner, 2026-09-30). Their bottom bar already
 * holds their few pages, so the strip, the bar and the ☰ menu listed the same
 * five pages three times on one phone screen.
 */
export function WorkspaceTabs() {
  const pathname = usePathname();
  const search = useSearchParams();
  const access = useAccess();
  const c = useCopy();

  if (access.role === "field" || access.role === "lead") return null;
  const here = locate(pathname);
  if (!here || NO_STRIP.has(here.tab.view)) return null;
  const tabs = reachableTabs(here.workspace, access.can);
  if (tabs.length < 2) return null;

  const qs = carryJobAndMonth(search);

  return (
    // From 2xl the sidebar lists these same tabs, so the strip steps aside.
    <nav aria-label={here.workspace.title} className="px-4 pt-3 print:hidden pad:px-7 2xl:hidden">
      <ChipScroller>
        {tabs.map((t) => {
          const on = t.view === here.tab.view;
          return (
            <Link
              key={t.view}
              href={t.href + qs}
              aria-current={on ? "page" : undefined}
              onClick={(e) => {
                if (!confirmLeaveIfDirty()) e.preventDefault();
              }}
              className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
                on
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line bg-white text-neutral-500 hover:border-accent dark:bg-ink-raised dark:text-neutral-400"
              }`}
            >
              {c(`home.dest.${t.view}.label`) || t.label}
            </Link>
          );
        })}
      </ChipScroller>
    </nav>
  );
}
